# Models

Paperwall ships no machine-learning weights. Features that need a model
download it once, only after the person says yes (the dialog shows the size,
the source and the license), check it against a pinned SHA-256 and keep it in
the browser's storage on that device. From then on they work offline, and
pictures never leave the device. The models run on Paperwall's own engine
(`src/model/onnx.js`, `src/model/onnx-ops.js`, `src/app/onnx-gl.js`), written
from the public ONNX format and operator descriptions.

## Background removal (IMG-11): U²-Net small ("u2netp")

| | |
| --- | --- |
| What | Salient object detection: a "how likely is this the subject" map for any photo |
| Model | U²-Net small (u2netp), 1.13 M parameters, 320×320 input, ONNX opset 11 |
| Authors | Xuebin Qin, Zichen Zhang, Chenyang Huang, Masood Dehghan, Osmar R. Zaiane, Martin Jagersand: "U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection", Pattern Recognition 106, 2020 |
| Upstream | https://github.com/xuebinqin/U-2-Net |
| License | **Apache-2.0** (the upstream repository's LICENSE, checked 2026-10-21). Commercial use, modification and redistribution are allowed |
| File | `https://cdn.jsdelivr.net/npm/@rmbg/model-u2netp@0.0.1/u2netp.onnx` |
| Size | 4,574,861 bytes (4.6 MB) |
| SHA-256 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |
| Host in the security policy | `https://cdn.jsdelivr.net` (provider `u2netp` in `src/model/providers.js`) |

### Where the file comes from

The ONNX file is the conversion of the upstream weights published by the
rembg project (MIT) as `u2netp.onnx` in its `v0.0.0` GitHub release. The npm
package `@rmbg/model-u2netp@0.0.1` carries a byte-identical copy (same
SHA-256, checked 2026-10-21), and jsDelivr serves npm files from a fixed,
versioned address with `Access-Control-Allow-Origin: *` and no redirects. The
GitHub and Hugging Face downloads both redirect to signed addresses on other
hosts, which the page's security policy would have to allow as well, so they
aren't used. Whatever the address serves, Paperwall only uses a file whose
SHA-256 matches the one above.

### Operations it uses

Conv (3×3, dilations 1, 2, 4 and 8; 1×1), Relu, MaxPool (2×2, ceil_mode),
Resize (linear, pytorch_half_pixel, output size from the input's shape),
Concat, Add, Sigmoid, and the shape bookkeeping around Resize (Shape,
Gather, Unsqueeze, Slice, Cast, Constant). About 20 billion multiply-adds per
picture.

### How it's used

The photo is squeezed to 320×320 (area-averaged), divided by its brightest
value and normalized with the usual ImageNet means and spreads; the first of
the model's seven outputs is stretched to 0..1, grown back to the photo's
size, its edges eased ("Refine edges": 0 keeps the model's soft edges, 100 is
crisp) and feathered by a pixel or so, and used as the picture's alpha.

### Speed

On a graphics card (WebGL2 with float textures) it runs as fragment shaders;
otherwise on the processor, a slice at a time so the page stays responsive,
with progress and Stop. Measured on the 4-core build machine (no GPU) in
Chromium: about 20 s on the processor. Software-emulated WebGL (SwiftShader,
llvmpipe) is skipped, as it's slower than the processor.

### Not used

- BRIA RMBG-1.4 / 2.0: non-commercial license.
- IS-Net / DIS ("isnet-general-use"): much bigger (about 170 MB) for a
  one-time download.
- MODNet: Apache-2.0 too, but made for portraits only.
