import shutil
import os

src = r"C:\Users\정우노트북\.gemini\antigravity\brain\b048d731-a78e-4fbd-afad-205440bed7c2\uploaded_media_1769789845219.png"
dst = r"C:\Users\정우노트북\.cursor\qplay\images\notice_preview.png"

try:
    shutil.copy2(src, dst)
    print("Success")
except Exception as e:
    print(f"Error: {e}")
