#!/usr/bin/env python3
"""基于 icons/logo.png 生成 Chrome 扩展所需的多尺寸图标。

策略：
- 以 logo.png 为源（RGBA），使用 LANCZOS 高质量降采样
- 输出 icon16.png / icon48.png / icon128.png，直接覆盖旧文件
- 依赖 Pillow（pip install Pillow）
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.stderr.write('需要 Pillow：pip install Pillow\n')
    raise

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'logo.png')
SIZES = (16, 48, 128)


def main():
    if not os.path.exists(SRC):
        raise SystemExit(f'未找到源图：{SRC}')
    src = Image.open(SRC).convert('RGBA')
    for s in SIZES:
        out = src.resize((s, s), Image.LANCZOS)
        path = os.path.join(HERE, f'icon{s}.png')
        out.save(path, optimize=True)
        print(f'wrote {path} ({s}x{s})')


if __name__ == '__main__':
    main()
