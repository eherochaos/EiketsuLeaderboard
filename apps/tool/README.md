# Eiketsu Collector Tool

Windows client tool for collecting and uploading Eiketsu Taisen match data.

## Commands

- `eiketsu-client bind`
- `eiketsu-client sync`
- `eiketsu-client doctor`
- `eiketsu-client-gui`

## Build

```powershell
python -m pip install -e .[client-build]
python -m PyInstaller deploy/pyinstaller/EiketsuCollector.spec --noconfirm
```
