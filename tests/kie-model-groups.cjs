// Run with Node.js and Playwright installed: node tests/kie-model-groups.cjs
// Uses an isolated headless browser and mocked APIs; no live generation or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const storageKey = 'canvas:kie-settings:v1';
const imageUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [];
    const submitted = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'canvas.test') {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        assert.ok(['index.html', 'app.js', 'style.css'].includes(file));
        return route.fulfill({
          body: fs.readFileSync(path.join(root, 'canvas', file)),
          contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
        });
      }
      if (url.pathname.endsWith('/createTask')) {
        submitted.push(route.request().postDataJSON());
        return route.fulfill({ json: { code: 200, data: { taskId: 'mock-task' } } });
      }
      if (url.pathname.endsWith('/recordInfo')) {
        return route.fulfill({ json: { code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [imageUrl] }) } } });
      }
      throw new Error(`Unexpected network request: ${url.origin}${url.pathname}`);
    });
    await page.goto('http://canvas.test/');
    // Existing v1 credentials migrate without losing the service configuration.
    await page.evaluate(({ storageKey }) => {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, baseUrl: 'https://mock-api.test', uploadBaseUrl: 'https://mock-upload.test', apiKey: 'test-only' }));
      loadKieSettings();
      globalThis.originalNode = createKieNode();
      originalNode.prompt.value = 'test prompt';
    }, { storageKey });
    assert.equal(await page.evaluate(() => buildKieCallPreview(originalNode).body.model), 'gpt-image-2-text-to-image');
    await page.getByRole('button', { name: '打开 KIE 设置' }).click();
    assert.equal(await page.locator('.model-group-card').count(), 1);
    assert.equal(await page.locator('.model-group-remove').isDisabled(), true);
    assert.equal(await page.locator('#kieApiKey').inputValue(), 'test-only');

    await page.getByRole('button', { name: '添加分组' }).click();
    const secondGroup = page.locator('.model-group-card').nth(1);
    await secondGroup.getByLabel('分组名称').fill('Custom <model>');
    await secondGroup.getByLabel('文生图模型').fill(' custom-text ');
    // A group must include both models.
    await page.getByRole('button', { name: '保存设置' }).click();
    assert.match(await page.locator('#settingsMessage').innerText(), /图生图模型/);
    await secondGroup.getByLabel('图生图模型').fill('custom-image');
    await secondGroup.getByLabel('默认分组').check();
    assert.equal(await page.locator('.model-group-default:checked').count(), 1);
    await page.getByRole('button', { name: '保存设置' }).click();
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    assert.equal(stored.modelGroups.length, 2);
    assert.equal(stored.modelGroups[1].textModel, 'custom-text');
    assert.equal(stored.defaultModelGroupId, stored.modelGroups[1].id);
    assert.equal(stored.apiKey, 'test-only');
    // Saving a new default does not override an existing node's selection.
    assert.equal(await page.evaluate(() => buildKieCallPreview(originalNode).body.model), 'gpt-image-2-text-to-image');
    await page.evaluate(() => {
      globalThis.customNode = createKieNode();
      customNode.prompt.value = 'custom prompt';
    });
    assert.equal(await page.evaluate(() => buildKieCallPreview(customNode).body.model), 'custom-text');
    assert.match(await page.locator('.kie-model').last().innerText(), /Custom <model>/);
    assert.equal(await page.locator('.kie-model model').count(), 0);
    await page.evaluate(() => generateWithKie(customNode));
    assert.equal(submitted.at(-1).model, 'custom-text');

    await page.evaluate(imageUrl => {
      globalThis.referenceNode = createImageNode({ source: { src: imageUrl, name: 'test-image' } });
      connectNodes(referenceNode.id, customNode.id);
    }, imageUrl);
    assert.equal(await page.evaluate(() => buildKieCallPreview(customNode).body.model), 'custom-image');
    assert.match(await page.evaluate(() => customNode.model.selectedOptions[0].textContent), /custom-image/);
    // Hold the upload step to test that a request retains its initial model selection.
    await page.evaluate(() => {
      globalThis.savedPrepare = prepareKieInputUrls;
      prepareKieInputUrls = () => new Promise(resolve => { globalThis.finishUpload = resolve; });
      globalThis.pendingGeneration = generateWithKie(customNode);
    });
    await page.getByRole('button', { name: '打开 KIE 设置' }).click();
    await page.locator('.model-group-card').nth(1).getByLabel('图生图模型').fill('custom-image-updated');
    await page.getByRole('button', { name: '保存设置' }).click();
    await page.evaluate(async () => {
      finishUpload({ urls: ['https://mock-images.test/reference.png'], uploaded: [] });
      await pendingGeneration;
      prepareKieInputUrls = savedPrepare;
    });
    assert.equal(submitted.at(-1).model, 'custom-image');
    assert.deepEqual(submitted.at(-1).input.input_urls, ['https://mock-images.test/reference.png']);
    assert.equal(await page.evaluate(() => buildKieCallPreview(customNode).body.model), 'custom-image-updated');

    await page.evaluate(() => { globalThis.clonedNode = cloneKieNode(customNode); });
    assert.equal(await page.evaluate(() => buildKieCallPreview(clonedNode).body.model), 'custom-image-updated');
    await page.evaluate(() => {
      const connection = Array.from(connections.values()).find(c => c.fromNodeId === referenceNode.id && c.toNodeId === customNode.id);
      removeConnection(connection.id);
    });
    assert.equal(await page.evaluate(() => buildKieCallPreview(customNode).body.model), 'custom-text');

    // Explicit selection and clone preserve a non-default group.
    await page.locator('[data-node-id="kie-2"] .kie-model').selectOption('image2');
    assert.equal(await page.evaluate(() => buildKieCallPreview(customNode).body.model), 'gpt-image-2-text-to-image');
    assert.equal(await page.evaluate(() => buildKieCallPreview(cloneKieNode(customNode)).body.model), 'gpt-image-2-text-to-image');

    // Closing without saving discards edits.
    await page.getByRole('button', { name: '打开 KIE 设置' }).click();
    await page.locator('.model-group-card').nth(1).getByLabel('文生图模型').fill('unsaved');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '打开 KIE 设置' }).click();
    assert.equal(await page.locator('.model-group-card').nth(1).getByLabel('文生图模型').inputValue(), 'custom-text');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.reload();
    assert.equal(await page.evaluate(() => buildKieCallPreview(createKieNode()).body.model), 'custom-text');

    // Removing a selected default falls back to the surviving group for current/new nodes.
    await page.getByRole('button', { name: '打开 KIE 设置' }).click();
    await page.locator('.model-group-card').nth(1).getByRole('button', { name: '删除分组' }).click();
    assert.equal(await page.locator('.model-group-default:checked').count(), 1);
    await page.getByRole('button', { name: '保存设置' }).click();
    assert.equal(await page.locator('.kie-model').inputValue(), 'image2');
    assert.equal(await page.evaluate(() => buildKieCallPreview(createKieNode()).body.model), 'gpt-image-2-text-to-image');
    // A fresh user can configure groups before supplying credentials.
    await page.getByRole('button', { name: '打开 KIE 设置' }).click();
    await page.locator('#kieApiKey').fill('');
    await page.getByRole('button', { name: '保存设置' }).click();
    assert.equal(await page.locator('#settingsDialog').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS: migration, paired-model validation, exclusive default, selection, actual request models, upload snapshot, cloning, disconnect, cancel, reload, deletion fallback, empty-key settings.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
