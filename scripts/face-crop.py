#!/usr/bin/env python3
"""
Face-tracking smart crop script using MediaPipe.
Usage: python3 face-crop.py <video_path> <aspect_ratio> <output_path>
  aspect_ratio: "9:16" | "1:1" | "16:9"
  output_path: ignored (detection only — FFmpeg handles encoding)
Output: JSON with crop dimensions and center coordinates to stdout
"""

import sys
import json

def detect_faces(video_path, aspect_ratio):
    try:
        import cv2
    except ImportError:
        print(json.dumps({"error": "opencv-python not installed. Run: pip install mediapipe opencv-python"}))
        sys.exit(1)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"Could not open video: {video_path}"}))
        sys.exit(1)

    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps

    print(f"Video: {W}x{H}, {fps:.1f}fps, {duration:.1f}s", file=sys.stderr)

    # Compute crop dimensions from aspect ratio
    ar_parts = aspect_ratio.split(":")
    ar_w, ar_h = int(ar_parts[0]), int(ar_parts[1])

    # Largest crop that fits inside the video at target AR
    if W / H > ar_w / ar_h:
        # Video is wider than target — crop width
        crop_h = H
        crop_w = int(H * ar_w / ar_h)
    else:
        # Video is taller than target — crop height
        crop_w = W
        crop_h = int(W * ar_h / ar_w)

    # Clamp to video bounds
    crop_w = min(crop_w, W)
    crop_h = min(crop_h, H)

    print(f"Crop size: {crop_w}x{crop_h}", file=sys.stderr)

    # Sample 1 frame per second
    sample_times = [i for i in range(int(duration) + 1)]
    if not sample_times:
        sample_times = [0]

    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    keyframes = []
    faces_detected = 0

    for t in sample_times:
        ms = t * 1000
        cap.set(cv2.CAP_PROP_POS_MSEC, ms)
        ret, frame = cap.read()
        if not ret:
            keyframes.append({"t": t, "cx": None, "cy": None})
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

        if len(faces) > 0:
            # Use the largest detected face (most prominent / closest to camera)
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            cx = x + w // 2
            cy = y + h // 2
            keyframes.append({"t": t, "cx": cx, "cy": cy})
            faces_detected += 1
            print(f"  t={t}s: face at ({cx}, {cy})", file=sys.stderr)
        else:
            keyframes.append({"t": t, "cx": None, "cy": None})

    cap.release()

    # Fill missing frames with linear interpolation or video center
    center_x = W // 2
    center_y = H // 2

    # Interpolate: find runs of None and fill
    filled = []
    for kf in keyframes:
        filled.append({"t": kf["t"], "cx": kf["cx"], "cy": kf["cy"]})

    # Forward/backward fill with interpolation
    for i in range(len(filled)):
        if filled[i]["cx"] is None:
            # Find previous valid
            prev = None
            for j in range(i - 1, -1, -1):
                if filled[j]["cx"] is not None:
                    prev = j
                    break
            # Find next valid
            nxt = None
            for j in range(i + 1, len(filled)):
                if filled[j]["cx"] is not None:
                    nxt = j
                    break

            if prev is not None and nxt is not None:
                # Linear interpolation
                t_range = filled[nxt]["t"] - filled[prev]["t"]
                alpha = (filled[i]["t"] - filled[prev]["t"]) / t_range if t_range > 0 else 0
                filled[i]["cx"] = int(filled[prev]["cx"] + alpha * (filled[nxt]["cx"] - filled[prev]["cx"]))
                filled[i]["cy"] = int(filled[prev]["cy"] + alpha * (filled[nxt]["cy"] - filled[prev]["cy"]))
            elif prev is not None:
                filled[i]["cx"] = filled[prev]["cx"]
                filled[i]["cy"] = filled[prev]["cy"]
            elif nxt is not None:
                filled[i]["cx"] = filled[nxt]["cx"]
                filled[i]["cy"] = filled[nxt]["cy"]
            else:
                filled[i]["cx"] = center_x
                filled[i]["cy"] = center_y

    # Apply exponential moving average (alpha=0.3) for smooth camera motion
    alpha = 0.3
    smooth_cx = float(filled[0]["cx"])
    smooth_cy = float(filled[0]["cy"])
    smoothed = []
    for kf in filled:
        smooth_cx = alpha * kf["cx"] + (1 - alpha) * smooth_cx
        smooth_cy = alpha * kf["cy"] + (1 - alpha) * smooth_cy
        # Clamp so crop stays within video bounds
        x = int(smooth_cx - crop_w / 2)
        y = int(smooth_cy - crop_h / 2)
        x = max(0, min(x, W - crop_w))
        y = max(0, min(y, H - crop_h))
        smoothed.append({"t": kf["t"], "x": x, "y": y})

    # Check if crop center barely moves (max drift < 30px) -> use static crop
    xs = [s["x"] for s in smoothed]
    ys = [s["y"] for s in smoothed]
    max_drift = max(max(xs) - min(xs), max(ys) - min(ys))

    print(f"Max drift: {max_drift}px, faces detected: {faces_detected}", file=sys.stderr)

    # Build output
    avg_x = int(sum(xs) / len(xs))
    avg_y = int(sum(ys) / len(ys))

    if max_drift < 10 or len(smoothed) <= 1:
        # Static crop — use average center
        result = {
            "cropW": crop_w,
            "cropH": crop_h,
            "facesDetected": faces_detected,
            "x": avg_x,
            "y": avg_y,
            "keyframes": []
        }
    else:
        result = {
            "cropW": crop_w,
            "cropH": crop_h,
            "facesDetected": faces_detected,
            "x": avg_x,
            "y": avg_y,
            "keyframes": smoothed
        }

    print(json.dumps(result))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 face-crop.py <video_path> <aspect_ratio> [output_path]", file=sys.stderr)
        sys.exit(1)

    video_path = sys.argv[1]
    aspect_ratio = sys.argv[2]

    if aspect_ratio not in ("9:16", "1:1", "16:9"):
        print(json.dumps({"error": f"Invalid aspect ratio '{aspect_ratio}'. Use 9:16, 1:1, or 16:9"}))
        sys.exit(1)

    try:
        detect_faces(video_path, aspect_ratio)
    except Exception as e:
        error_msg = str(e)
        print(f"Error: {error_msg}", file=sys.stderr)
        print(json.dumps({"error": error_msg}))
        sys.exit(1)
