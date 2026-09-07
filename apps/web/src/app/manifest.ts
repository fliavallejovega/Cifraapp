import type { MetadataRoute } from 'next';

/**
 * The installable app.
 *
 * `start_url` is the bare origin: the proxy negotiates the locale and the
 * session decides between the landing, sign-in and the position, which is
 * exactly the logic an install shortcut should reuse rather than duplicate.
 *
 * Colors are the light-theme token values, resolved — a manifest cannot read
 * CSS. `background_color` paints the splash while the app boots; `theme_color`
 * tints the OS chrome to the panel ink so the installed app opens looking like
 * its own sidebar.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Norte',
    short_name: 'Norte',
    description:
      'Tu sistema financiero: cuánto tienes, qué está comprometido y qué hacer con lo que queda.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f7f5f0',
    theme_color: '#151d2e',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
