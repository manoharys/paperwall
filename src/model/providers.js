// The online extras' providers (opt-in; see src/app/online.js). Pure data,
// shared with the build, which lists their hosts in the page's security
// policy: the page can talk to these and nothing else.

/**
 * Every provider, by what it's for. `key`: whether it needs the person's own
 * key (and where to get one). `hosts`: the only places it talks to (the
 * page's security policy lists them; see scripts/build.mjs).
 */
export const PROVIDERS = {
  openverse: { name: 'Openverse', for: ['photos'], key: false, site: 'https://openverse.org', hosts: ['https://api.openverse.org'] },
  unsplash: { name: 'Unsplash', for: ['photos'], key: true, keyUrl: 'https://unsplash.com/developers', hosts: ['https://api.unsplash.com', 'https://images.unsplash.com'] },
  pexels: { name: 'Pexels', for: ['photos'], key: true, keyUrl: 'https://www.pexels.com/api/', hosts: ['https://api.pexels.com', 'https://images.pexels.com'] },
  claude: { name: 'Claude (Anthropic)', for: ['writing', 'design'], key: true, keyUrl: 'https://console.anthropic.com/settings/keys', hosts: ['https://api.anthropic.com'] },
  openai: { name: 'OpenAI', for: ['writing', 'design'], key: true, keyUrl: 'https://platform.openai.com/api-keys', hosts: ['https://api.openai.com'] },
  gemini: { name: 'Gemini (Google)', for: ['writing', 'design'], key: true, keyUrl: 'https://aistudio.google.com/apikey', hosts: ['https://generativelanguage.googleapis.com'] },
  ollama: { name: 'Ollama (on this computer)', for: ['writing', 'design'], key: false, site: 'https://ollama.com', hosts: ['http://localhost:11434', 'http://127.0.0.1:11434'] },
  // A model file, downloaded once and then run on this device: pictures never
  // leave it. Pinned to one exact file, checked by its SHA-256 (docs/MODELS.md).
  u2netp: {
    name: 'U²-Net small (runs on this device)', for: ['cutout'], key: false, site: 'https://github.com/xuebinqin/U-2-Net', hosts: ['https://cdn.jsdelivr.net/npm/@rmbg/model-u2netp@0.0.1/u2netp.onnx'], // (just the file: not all of the CDN)
    model: {
      url: 'https://cdn.jsdelivr.net/npm/@rmbg/model-u2netp@0.0.1/u2netp.onnx',
      sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
      bytes: 4574861,
      license: 'Apache-2.0',
    },
  },
};

/** What the online extras are, each with the provider used until another is picked. */
export const FEATURES = {
  photos: { name: 'Stock photos', default: 'openverse' },
  writing: { name: 'AI writing', default: 'claude' },
  design: { name: 'AI design', default: 'claude' },
  cutout: { name: 'Background removal model', default: 'u2netp' },
};

/** Every host any provider talks to (for the page's security policy). */
export function onlineHosts() {
  return [...new Set(Object.values(PROVIDERS).flatMap((p) => p.hosts))];
}
