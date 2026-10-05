"""Une docs/assets/demo-frames/*.png en docs/assets/demo.gif (Pillow)."""
import glob, os
from PIL import Image

root = os.path.join(os.path.dirname(__file__), '..')
frames = sorted(glob.glob(os.path.join(root, 'docs/assets/demo-frames/*.png')))
imgs = []
for f in frames:
    im = Image.open(f).convert('RGB')
    im = im.resize((im.width * 2 // 3, im.height * 2 // 3), Image.LANCZOS)
    imgs.append(im.convert('P', palette=Image.ADAPTIVE, colors=128))
durations = [220] * len(imgs)
durations[-1] = 2500
out = os.path.join(root, 'docs/assets/demo.gif')
imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=durations, loop=0, optimize=True)
print(out, len(imgs), 'frames', round(os.path.getsize(out) / 1e6, 2), 'MB')
