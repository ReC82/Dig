/**
 * public/sw.js — service worker de DIG! (#21)
 *
 * Servi par le serveur sur /sw.js avec la version de l'application injectée
 * (__APP_VERSION__) et sans cache HTTP : chaque déploiement change ce fichier,
 * le navigateur installe la nouvelle version et les anciens caches sont supprimés.
 *
 * Stratégie volontairement prudente :
 *  - page d'accueil (navigation) : réseau d'abord, copie en cache pour le hors-ligne ;
 *  - fichiers statiques versionnés (?v=…) : cache d'abord (ils ne changent jamais) ;
 *  - tout le reste (API, admin, autres origines, POST…) : non intercepté.
 */
'use strict';

const VERSION = '__APP_VERSION__';
const CACHE   = `dig-${VERSION}`;
const SHELL   = '/';

/** Extrait les fichiers locaux versionnés (?v=) référencés par la page d'accueil. */
function versionedAssets(html) {
  const urls = new Set();
  const re = /(?:href|src)="(?!https?:|\/\/)([^"]+\?v=[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) urls.add(new URL(m[1], self.location.origin).href);
  return [...urls];
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch(SHELL, { cache: 'no-store' });
    if (res.ok) {
      await cache.put(SHELL, res.clone());
      // Préchargement best-effort : un fichier manquant ne bloque pas l'installation.
      await Promise.all(versionedAssets(await res.text()).map(u => cache.add(u).catch(() => {})));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('dig-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  if (req.mode === 'navigate') {
    if (url.pathname !== '/' && url.pathname !== '/index.html') return;
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(SHELL, res.clone());
        }
        return res;
      } catch (err) {
        const cached = await caches.match(SHELL);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  if (url.searchParams.has('v')) {
    event.respondWith((async () => {
      const cache  = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
  }
});
