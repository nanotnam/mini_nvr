# Doc zlmediakit - namvh45

```
Camera (RTSP)
     ↓
addStreamProxy
     ↓
ZLMediaKit
 ├ RTSP output
 ├ WebRTC output
 ├ HLS output
 └ Recording (API triggered)
 ```

disable cái vhost để dùng được webrtc nêu toggle on thì phải chỉnh cái cấu trúc folder trong ./www
```
[general]
enableVhost=0
```

cách bật trên con aiteam (phải trỏ đến libsrtp 2.6.0, nếu không dùng LD_LIBRARY_PATH thì nó sẽ trỏ về mặc định 2.3.0)
```
cd /mnt/data1/namvh45/tool/ZLMediaKit/release/linux/Debug
LD_LIBRARY_PATH=/mnt/data1/namvh45/tool/libsrtp-local/lib:$LD_LIBRARY_PATH ./MediaServer -d
```

## add stream

curl -X POST "http://192.168.1.205:8080/index/api/addStreamProxy" \
  -d "secret=1" \
  -d "vhost=__defaultVhost__" \
  -d "app=view" \
  -d "stream=camera3" \
  -d "url=rtsp://admin:Llq123a@@192.168.1.243/1" \
  -d "rtp_type=0" \
  -d "retry_count=-1" \
  -d "enable_hls=1" \
  -d "enable_rtsp=1" \
  -d "enable_mp4=0" \
  -d "auto_close=0"

rtp_type: When streaming RTSP, the streaming mode is: 0: TCP, 1: UDP, 2: multicast.

| Parameter | Value | Why |
|---|---|---|
| rtp_type=0 | TCP | More reliable over network |
| retry_count=-1 | Infinite retry | Auto-reconnects if camera drops |
| enable_hls=1 | On | Generates HLS immediately |
| enable_rtsp=1 | On | Enables RTSP + WebRTC output |
| enable_mp4=0 | Off | You'll start recording on-demand via API |

*TODO* note other params, vhost/app...

### rtsp
```
rtsp://192.168.1.205:8555/view/camera1
```

### hls
```
http://192.168.1.205:8080/view/camera1/hls.m3u8
```

### webrtc

demo link

http://192.168.1.205:8080/webrtc/?app=view&stream=camera1&type=play

http://192.168.1.205:8080/index/api/webrtc?app=view&stream=camera1&type=play

### record
```
curl "http://192.168.1.205:8080/index/api/startRecord?\
secret=1&\
type=1&\
vhost=__defaultVhost__&\
app=view&\
stream=camera2&\
max_second=3600"
```

```
curl "http://192.168.1.205:8080/index/api/stopRecord?\
secret=1&\
type=1&\
vhost=__defaultVhost__&\
app=view&\
stream=camera1"
```

```
curl "http://192.168.1.205:8080/index/api/isRecording?\
secret=1&\
type=1&\
vhost=__defaultVhost__&\
app=view&\
stream=camera1"
```


*webrtc does not support h265*

## add ffmpeg source 
always ->decode->encode->h264
```
curl "http://127.0.0.1:8080/index/api/addFFmpegSource?secret=1&src_url=rtsp://admin:Llq123a%40@192.168.1.243/0&dst_url=rtsp://127.0.0.1:8555/view/camera4&timeout_ms=10000"

curl -X POST "http://127.0.0.1:8080/index/api/addFFmpegSource" \
     -d "secret=a6G0ZAJK2bGN4gY7NNLKjueUrEHIbQEB" \
     -d "src_url=rtsp://admin:Llq123a%40@192.168.1.244/0" \
     -d "dst_url=rtmp://127.0.0.1:1935/view/camera4" \
     -d "timeout_ms=10000"

```

## swagger link

http://192.168.1.205:8080/swagger/index.html#/




ffmpeg -rtsp_transport tcp -i rtsp://admin:Llq123a@@192.168.1.244/1 \
-vcodec h264 -acodec aac \
-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:554/view/llq

[Audio] Codec mpeg4-generic, 8000Hz, 1ch 
[Video] Codec H264, 1280x720@25FPS, GOP 1 (2292ms)
Bitrate: 0.48 Mbps   Viewers: 0   Traffic: 786.38 KB


ffmpeg -rtsp_transport tcp -i rtsp://admin:Llq123a@@192.168.1.247/1 \
-vf scale=1280:720 -r 15 \
-c:v libx264 -preset veryfast -tune zerolatency -b:v 1M -maxrate 1M -bufsize 2M \
-c:a aac -b:a 64k \
-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:554/view/llq2

[Audio] Codec mpeg4-generic, 8000Hz, 1ch
[Video] Codec H264, 1280x720@15FPS, GOP 11 (27ms)
Bitrate: 1.08 Mbps   Viewers: 0   Traffic: 2 MB


ffmpeg -rtsp_transport tcp -i rtsp://admin:Llq123a@@192.168.1.244/1 \
-vcodec h264 -acodec aac -r 15 \
-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:554/view/llq

[Audio] Codec mpeg4-generic, 8000Hz, 1ch
[Video] Codec H264, 1280x720@15FPS, GOP 1 (3960ms)


ffmpeg -rtsp_transport tcp -i rtsp://admin:Llq123a@@192.168.1.244/1 \
-vf scale=1280:720 -r 15 \
-c:v libx264 -preset veryfast \
-c:a aac -b:a 64k \
-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:554/view/llq

[Audio] Codec mpeg4-generic, 8000Hz, 1ch
[Video] Codec H264, 1280x720@15FPS, GOP 1 (1983ms)


ffmpeg -rtsp_transport tcp -i rtsp://admin:Llq123a@@192.168.1.244/1 \
-vf scale=1280:720 -r 15 \
-c:v libx264 -preset veryfast -tune zerolatency \
-c:a aac -b:a 64k \
-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:554/view/llq

[Audio] Codec mpeg4-generic, 8000Hz, 1ch
[Video] Codec H264, 1280x720@15FPS, GOP 11 (41ms)


ffmpeg -rtsp_transport tcp -i rtsp://admin:Llq123a@@192.168.1.244/1 \
-vf scale=1280:720 -r 15 \
-c:v libx264 -tune zerolatency \
-c:a aac -b:a 64k \
-f rtsp -rtsp_transport tcp rtsp://127.0.0.1:554/view/llq

[Audio] Codec mpeg4-generic, 8000Hz, 1ch
[Video] Codec H264, 1280x720@15FPS, GOP 22 (43ms)