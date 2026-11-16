import { defineConfig } from 'vitepress'

const MOTIONCORE = 'https://motioncore.bzy-logics.com'
const RATAVYR = 'https://ratavyr.bzy-logics.com'

export default defineConfig({
  title: 'sindrava',
  description: 'Browser operator UI for MotionCore robots',
  cleanUrls: true,
  head: [['link', { rel: 'icon', href: '/logo.svg', type: 'image/svg+xml' }]],
  srcExclude: ['README.md'],
  sitemap: { hostname: 'https://sindrava.bzy-logics.com' },

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Development', link: '/development/api-client', activeMatch: '/development/' },
      {
        text: 'Docs',
        items: [
          { text: 'motioncore — engine & firmware', link: MOTIONCORE },
          { text: 'ratavyr — REST/WebSocket gateway', link: RATAVYR },
          { text: 'sindrava — operator UI', link: '/' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/bzy-logics/sindrava' }],

    editLink: {
      pattern: 'https://github.com/bzy-logics/sindrava/edit/main/website/:path',
      text: 'Edit this page on GitHub',
    },

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Screens', link: '/guide/screens' },
            { text: 'Signing in & roles', link: '/guide/authentication' },
            { text: 'Safety behaviour', link: '/guide/safety' },
          ],
        },
        {
          text: 'Elsewhere',
          items: [
            { text: 'Robot states ↗', link: `${MOTIONCORE}/guide/robot-states` },
            { text: 'Moving axes ↗', link: `${MOTIONCORE}/guide/motion` },
            { text: 'Deploying the gateway ↗', link: `${RATAVYR}/guide/deployment` },
          ],
        },
      ],
      '/development/': [
        {
          text: 'Development',
          items: [
            { text: 'API client', link: '/development/api-client' },
            { text: 'Testing', link: '/development/testing' },
            { text: 'Code layout & limitations', link: '/development/layout' },
          ],
        },
        {
          text: 'Elsewhere',
          items: [
            { text: 'REST API ↗', link: `${RATAVYR}/reference/rest-api` },
            { text: 'WebSocket ↗', link: `${RATAVYR}/reference/websocket` },
          ],
        },
      ],
    },

    search: { provider: 'local' },
    outline: { level: [2, 3] },

    footer: {
      message: 'Part of MotionCore. Licensed under GPL-3.0. The on-screen E-STOP is a software stop — it never replaces a hardware E-stop circuit.',
    },
  },
})
