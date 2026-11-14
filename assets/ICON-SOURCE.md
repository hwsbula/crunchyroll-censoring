# Icon source

The Crunchyroll symbol comes from [CoreUI Icons](https://github.com/coreui/coreui-icons/blob/main/svg/brand/cib-crunchyroll.svg), blob `de21c72771004c344aaf56455c0a7983c728c6db`.
CoreUI's [license](https://github.com/coreui/coreui-icons/blob/main/LICENSE) places its brand icons under CC0 1.0. Crunchyroll is a trademark of its respective owner; this independent extension is not affiliated with or endorsed by Crunchyroll.

Changes: white fill, an orange `#ff6400` square background and centered padding matching the requested example. `assets/icon.svg` is the local master; `public/icons/icon-{16,32,48,128}.png` are bundled raster sizes. No image is fetched at extension runtime.

To regenerate with Inkscape installed, run from the repository root:

```bash
for size in 16 32 48 128; do
  inkscape assets/icon.svg --export-type=png --export-width="$size" --export-height="$size" --export-filename="public/icons/icon-$size.png"
done
```
