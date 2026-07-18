# Eiketsu Collector Tool

Windows client tool for collecting and uploading Eiketsu Taisen match data.

## Commands

- `eiketsu-client bind`
- `eiketsu-client sync`
- `eiketsu-client doctor`
- `eiketsu-client-gui`

## 自动任务

- 必须先完成绑定和会员区登录。
- 配置任务后关闭窗口将保留系统托盘。
- 暂停调度仍会保留系统托盘。
- 每日时间和战祭时段统一使用日本时间。
- 彻底退出只能从托盘菜单执行。

## Build

```powershell
python -m pip install -e .[client-build]
python -m PyInstaller deploy/pyinstaller/EiketsuCollector.spec --noconfirm
```
