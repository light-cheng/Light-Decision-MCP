import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { ERROR_CODES } from "../src/core/errors.mjs";
import { loadImages, sniffImageMime } from "../src/core/images.mjs";

// Minimal valid 1x1 PNG bytes
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2dIAAAAASUVORK5CYII=",
  "base64",
);

describe("image loader & security checks", () => {
  let tmpDir;
  let pngPath;
  let fakePngPath;
  let bigPngPath;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ldm-img-"));
    pngPath = path.join(tmpDir, "valid.png");
    fakePngPath = path.join(tmpDir, "spoofed.png");
    bigPngPath = path.join(tmpDir, "oversized.png");
    await fs.writeFile(pngPath, TINY_PNG);
    await fs.writeFile(fakePngPath, "not actually a png image!");
    await fs.writeFile(bigPngPath, Buffer.concat([TINY_PNG, Buffer.alloc(2048)]));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("sniffs PNG/JPEG/WEBP/GIF magic bytes accurately", () => {
    assert.equal(sniffImageMime(TINY_PNG), "image/png");
    assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
    assert.equal(sniffImageMime(Buffer.from("GIF89a000000")), "image/gif");
    assert.equal(sniffImageMime(Buffer.from("RIFF0000WEBP")), "image/webp");
    assert.equal(sniffImageMime(Buffer.from("plain text file content")), null);
  });

  it("loads local PNG file into data URI and accepts data URIs & https URLs", async () => {
    const dataUri = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
    const loaded = await loadImages(["valid.png", dataUri, "https://example.com/photo.jpg"], {
      baseDir: tmpDir,
    });
    assert.equal(loaded.length, 3);
    assert.equal(loaded[0].source, "file");
    assert.equal(loaded[0].mimeType, "image/png");
    assert.ok(loaded[0].url.startsWith("data:image/png;base64,"));
    assert.equal(loaded[1].source, "data_uri");
    assert.equal(loaded[2].source, "https");
    assert.equal(loaded[2].url, "https://example.com/photo.jpg");
  });

  it("rejects spoofed files, directories, oversized images, http:// and file:// URLs", async () => {
    await assert.rejects(
      () => loadImages([fakePngPath]),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS,
    );
    await assert.rejects(
      () => loadImages([tmpDir]),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS,
    );
    await assert.rejects(
      () => loadImages([bigPngPath], { maxBytes: 512 }),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS,
    );
    await assert.rejects(
      () => loadImages(["http://127.0.0.1/secret.png"]),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS,
    );
    await assert.rejects(
      () => loadImages(["file:///etc/passwd"]),
      (e) => e.code === ERROR_CODES.INVALID_ARGUMENTS,
    );
  });
});
