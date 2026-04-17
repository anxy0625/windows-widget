# windows-widget

windows 系统的桌面小部件，可以展示 TopN 的CPU、内存占用的进程，并支持kill这些进程。
桌面小部件主要展示了 CPU、内存、天气、日期、时间等信息，支持对展示内容进行配置。

## 创建Windows桌面快捷方式

例如：如果这个项目在D盘，则创建桌面快捷图标，并在快捷图标的【目标】文本框中填写如下内容。
`C:\Windows\system32\wscript.exe "d:\windows_widget\launch.vbs"`

这样双击桌面图标，即可快捷启动此桌面小部件。
