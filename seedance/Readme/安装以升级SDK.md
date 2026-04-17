方舟提供了 Python 、 Go 和 Java 的 SDK ，方便使用对应编程语言快速调用方舟的模型服务。
<span id="2708d57e"></span>
# Python SDK
<span id="f2baa8aa"></span>
## 前提条件
本地已安装了 Python ，且版本不低于 3.7。
> 可在终端中通过命令确认 Python 版本。

```Bash
python -V
```

> Python 可使用 [UV](https://docs.astral.sh/uv/) 安装，并通过它来管理虚拟环境。UV 是一个 Rust 编写的、速度极快的 Python 包和项目管理器，可以方便进行环境隔离，避免干扰您系统中已有的 Python 配置。

<span id="bb014324"></span>
## 安装 Python SDK
在终端中执行命令安装 Python SDK。
```Bash
pip install 'volcengine-python-sdk[ark]'
```

:::tip

* 如本地安装错误，可尝试下面方法：
   * [Windows系统安装SDK失败，ERROR: Failed building wheel for volcengine-python-sdk](/docs/82379/1359411#b74e8ad6)
   * 尝试使用下面命令 `uv pip install volcengine-python-sdk[ark]`
* 如需源码安装，可下载&解压对应版本 SDK 包，进入目录执行命令：`python setup.py install --user`。
* 如使用了uv，可以通过 `uv pip install 'volcengine-python-sdk[ark]'` 命令安装 SDK。

:::
<span id="d6b883b8"></span>
## 升级 Python SDK
如需使用方舟提供的最新能力，请升级 SDK 至最新版本。
```Bash
pip install 'volcengine-python-sdk[ark]' -U
```

