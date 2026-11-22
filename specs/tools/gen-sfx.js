// Usage: node specs/tools/gen-sfx.js <path to the ls-clad build-sfx skill's tools folder>
// (CLAD's algorithmic synth; e.g. ~/.claude/plugins/cache/ls-extensions/ls-clad/<version>/skills/build-sfx/tools).
// Ports the WebXR makeAudio() tones (triangle notes, 10 ms attack, exponential decay) to WAVs.
const path = require('path');
const fs = require('fs');
const audio = require(process.env.CLAD_SFX_TOOLS || process.argv[2]);
const PROJECT_ASSETS_SFX = path.resolve(__dirname, '../MarsHomecoming/Assets/GeneratedSFX');
fs.mkdirSync(PROJECT_ASSETS_SFX, { recursive: true });
const SR = audio.SAMPLE_RATE;
const tones = {
  MarsBuild: [[523, 0], [784, 0.08]],
  MarsFail: [[220, 0], [180, 0.1]],
  MarsCoin: [[988, 0], [1319, 0.05]],
  MarsMilestone: [[659, 0], [784, 0.1], [1047, 0.2], [1319, 0.3]],
  MarsCloud: [[1568, 0], [1175, 0.07], [880, 0.14]],
};
for (const [name, notes] of Object.entries(tones)) {
  const end = Math.max(...notes.map(([, at]) => at)) + 0.2;
  const out = new Float32Array(Math.ceil(end * SR));
  for (const [f, at] of notes) {
    const n = audio.sweep(f, f, 0.16, 'triangle', 'linear');
    audio.adsrExp(n, 0.01, 0.05, 0.25, 0.1, 4);
    audio.fadeOut(n, 0.005);
    audio.addInto(out, n, Math.floor(at * SR), 0.5);
  }
  const res = audio.mix_bus.applyFx(out, { hpf: 120, gain: 0.9 });
  audio.fadeOut(res, 0.008);
  audio.mix_bus.masterChain(res, { normalize: 'peak' });
  audio.WavBuilder.write(res, path.join(PROJECT_ASSETS_SFX, `${name}.wav`));
  console.log('wrote', name);
}
