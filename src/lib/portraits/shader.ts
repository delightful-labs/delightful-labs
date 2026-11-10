import {
  imageDitheringFragmentShader,
  ShaderFitOptions,
  type ImageDitheringUniforms,
} from "@paper-design/shaders";

// Keep Paper's image filter intact, then reveal its output on a stable pixel grid.
export const portraitShader =
  imageDitheringFragmentShader.replace("void main()", "void paperImage()") +
  `
uniform float u_reveal;
void main() {
  paperImage();
  vec2 cell = floor(gl_FragCoord.xy / (u_pixelRatio * u_pxSize));
  float threshold = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float visible = step(0.001 + 0.998 * threshold, u_reveal);
  // Premultiplied transparency fades each dot into the actual page background.
  fragColor *= visible * u_reveal;
}
`;

export function portraitUniforms(
  image: HTMLImageElement,
): ImageDitheringUniforms & { u_image: HTMLImageElement } {
  return {
    u_image: image,
    u_colorBack: [0, 0, 0, 1],
    u_colorFront: [1, 1, 1, 1],
    u_colorHighlight: [1, 1, 1, 1],
    u_originalColors: false,
    u_inverted: false,
    u_type: 4,
    u_pxSize: 2,
    u_colorSteps: 3,
    u_fit: ShaderFitOptions.cover,
    u_scale: 1,
    u_rotation: 0,
    u_originX: 0.5,
    u_originY: 0.5,
    u_offsetX: 0,
    u_offsetY: 0,
    u_worldWidth: 0,
    u_worldHeight: 0,
  };
}
