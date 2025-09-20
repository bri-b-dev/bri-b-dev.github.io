import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Brigitte Böhm\'s homepage',
  tagline: 'Cloud & Data Platform Engineer',
  favicon: 'img/favicon.svg',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://bri-b-dev.github.io',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'bri-b-dev', // Usually your GitHub org/user name.
  projectName: 'bri-b-dev.github.io', // Usually your repo name.

  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: false,
        // docs: {
        //   sidebarPath: './sidebars.ts',
        //   // Please change this to your repo.
        //   // Remove this to remove the "edit this page" links.
        //   editUrl:
        //     'https://github.com/bri-b-dev/bri-b-dev.github.io/tree/main/packages/create-docusaurus/templates/shared/',
        // },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/bri-b-dev/bri-b-dev.github.io/tree/main/packages/create-docusaurus/templates/shared/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Home',
      logo: {
        alt: 'My Site Logo',
        src: 'img/logo.svg',
      },
      items: [
        {to: '/about', label: 'About', position: 'left'},
        {to: '/blog', label: 'Blog', position: 'left'},
        {href: 'mailto:brigitte_boehm@outlook.de', label: 'Kontakt', position: 'right'},
        {href: 'https://github.com/bri-b-dev', label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Navigation',
          items: [
            {label: 'About', to: '/about'},
            {label: 'Blog', to: '/blog'},
          ],
        },
        {
          title: 'Kontakt',
          items: [
            {label: 'E‑Mail', href: 'mailto:brigitte_boehm@outlook.de'},
            {label: 'LinkedIn', href: 'https://www.linkedin.com/in/brigitte-boehm-34b7a025/'},
            {label: 'GitHub', href: 'https://github.com/bri-b-dev'},
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Brigitte Böhm`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['java', 'kotlin', 'bash', 'json', 'yaml'],
    },
    // Optional: Announcement Bar
    announcementBar: {
      id: 'job-hint',
      content: '🚀 Offen für spannende Rollen in Backend & Cloud – <a href="mailto:brigitte.boehm@outlook.de">Kontakt</a>',
      isCloseable: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
