"""从 marblexu/PythonPlantsVsZombies 导入额外素材，并生成 js/manifest.js。

用法：python3 tools/import_assets.py <PythonPlantsVsZombies/resources/graphics 路径>
不带参数时只重新生成 manifest。
"""
import os, re, sys, json, shutil
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'images')

# 目标目录 <- 源目录（相对 resources/graphics）
IMPORTS = {
    'z/normal/walk': 'Zombies/NormalZombie/Zombie',
    'z/normal/attack': 'Zombies/NormalZombie/ZombieAttack',
    'z/normal/lostwalk': 'Zombies/NormalZombie/ZombieLostHead',
    'z/normal/lostattack': 'Zombies/NormalZombie/ZombieLostHeadAttack',
    'z/normal/head': 'Zombies/NormalZombie/ZombieHead',
    'z/normal/die': 'Zombies/NormalZombie/ZombieDie',
    'z/normal/boom': 'Zombies/NormalZombie/BoomDie',
    'z/cone/walk': 'Zombies/ConeheadZombie/ConeheadZombie',
    'z/cone/attack': 'Zombies/ConeheadZombie/ConeheadZombieAttack',
    'z/bucket/walk': 'Zombies/BucketheadZombie/BucketheadZombie',
    'z/bucket/attack': 'Zombies/BucketheadZombie/BucketheadZombieAttack',
    'z/flag/walk': 'Zombies/FlagZombie/FlagZombie',
    'z/flag/attack': 'Zombies/FlagZombie/FlagZombieAttack',
    'z/flag/lostwalk': 'Zombies/FlagZombie/FlagZombieLostHead',
    'z/flag/lostattack': 'Zombies/FlagZombie/FlagZombieLostHeadAttack',
    'z/paper/walk': 'Zombies/NewspaperZombie/NewspaperZombie',
    'z/paper/attack': 'Zombies/NewspaperZombie/NewspaperZombieAttack',
    'z/paper/nopaperwalk': 'Zombies/NewspaperZombie/NewspaperZombieNoPaper',
    'z/paper/nopaperattack': 'Zombies/NewspaperZombie/NewspaperZombieNoPaperAttack',
    'z/paper/lostwalk': 'Zombies/NewspaperZombie/NewspaperZombieLostHead',
    'z/paper/lostattack': 'Zombies/NewspaperZombie/NewspaperZombieLostHeadAttack',
    'z/paper/die': 'Zombies/NewspaperZombie/NewspaperZombieDie',
    'p/snowpea/idle': 'Plants/SnowPea',
    'p/threepeater/idle': 'Plants/Threepeater',
    'p/potatomine/init': 'Plants/PotatoMine/PotatoMineInit',
    'p/potatomine/idle': 'Plants/PotatoMine/PotatoMine',
    'p/potatomine/explode': 'Plants/PotatoMine/PotatoMineExplode',
    'p/squash/idle': 'Plants/Squash/Squash',
    'p/squash/aim': 'Plants/Squash/SquashAim',
    'p/squash/attack': 'Plants/Squash/SquashAttack',
    'p/jalapeno/idle': 'Plants/Jalapeno/Jalapeno',
    'p/jalapeno/explode': 'Plants/Jalapeno/JalapenoExplode',
    'p/spikeweed/idle': 'Plants/Spikeweed/Spikeweed',
    'misc/sun': 'Plants/Sun',
    'misc/peaice': 'Bullets/PeaIce',
}


def num_key(name):
    m = re.findall(r'\d+', name)
    return int(m[-1]) if m else 0


def make_transparent(im):
    """把与边缘相连的纯色底（白/黑）抠成透明。"""
    im = im.convert('RGBA')
    w, h = im.size
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    for s in seeds:
        r, g, b, a = im.getpixel(s)
        if a > 0 and (min(r, g, b) > 235 or max(r, g, b) < 20):
            ImageDraw.floodfill(im, s, (0, 0, 0, 0), thresh=40)
    return im


def import_from(src_root):
    for dst, src in IMPORTS.items():
        sdir = os.path.join(src_root, src)
        ddir = os.path.join(IMG, dst)
        if os.path.isdir(ddir):
            shutil.rmtree(ddir)
        os.makedirs(ddir)
        files = sorted([f for f in os.listdir(sdir) if f.lower().endswith(('.png', '.gif'))], key=num_key)
        for i, f in enumerate(files):
            make_transparent(Image.open(os.path.join(sdir, f))).save(os.path.join(ddir, '%02d.png' % i))
        print('%-28s %d' % (dst, len(files)))


def gen_manifest():
    """扫描动画帧目录，生成 { 'key': [path, ...] }。"""
    out = {}
    for base in ('plants', 'zombies', 'z', 'p', 'misc', 'loading'):
        for dirpath, _, files in os.walk(os.path.join(IMG, base)):
            frames = sorted([f for f in files if f.endswith('.png')], key=num_key)
            if frames:
                rel = os.path.relpath(dirpath, IMG)
                out[rel] = [rel + '/' + f for f in frames]
    js = '// 由 tools/import_assets.py 自动生成，请勿手改\nconst MANIFEST = ' + json.dumps(out, indent=0, sort_keys=True) + '\n'
    with open(os.path.join(ROOT, 'js', 'manifest.js'), 'w') as f:
        f.write(js)
    print('manifest: %d 组动画' % len(out))


if __name__ == '__main__':
    if len(sys.argv) > 1:
        import_from(sys.argv[1])
    gen_manifest()
