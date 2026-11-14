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

For the Web Store, `assets/store-icon.svg` wraps the chosen artwork in a 128px canvas with a 96px square and 16px transparent padding. Regenerate `public/icons/icon-128.png` from that file at 128×128. Toolbar 16/32/48 sizes remain from `assets/icon.svg`. The publisher must confirm permitted brand use; the package does not establish trademark authorization or guarantee store acceptance.
