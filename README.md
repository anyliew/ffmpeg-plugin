# ffmpeg-plugin

基于 FFmpeg 的 Yunzai-Bot 插件，提供音视频处理及信息查询功能。



## 功能列表

| 命令        | 功能            | 说明                                        |
| ----------- | --------------- | ------------------------------------------- |
| `#转动图`   | 视频转 GIF      | fps=12，宽度 320，Lanczos 算法              |
| `#转语音`   | 视频转 MP3 语音 | 提取视频中的音频并发送语音消息              |
| `#动图分解` | GIF 分解为帧图  | 将 GIF 动图拆分为 PNG 帧序列（最多 100 帧） |
| `#图片信息` | 查看图片信息    | 格式、分辨率、大小，GIF 额外显示帧数/帧率   |
| `#视频信息` | 查看视频信息    | 容器、编码、分辨率、时长、码率、音频参数等  |
| `#音频信息` | 查看音频信息    | 编码格式、时长、比特率、采样率、声道数      |



## 安装

进入 Yunzai-Bot 目录下

```bash
git clone --depth=1 https://github.com/anyliew/ffmpeg-plugin.git ./plugins/ffmpeg-plugin
```

安装依赖

```
cd ./plugins/ffmpeg-plugin
pnpm i
```



**确保系统已安装 FFmpeg**（插件依赖 ffmpeg/ffprobe 命令）

- Windows：下载并添加到 PATH
- Linux：`sudo apt install ffmpeg`
- 验证：`ffmpeg -version`