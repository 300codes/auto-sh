import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertSafeDirectory, assertContainedPath } from './paths.ts'

export async function scaffoldTheme(sitePath: string, themeSlug: string, title: string): Promise<{ themePath: string; files: string[] }> {
  if (!/^[a-z][a-z0-9-]{0,59}$/.test(themeSlug) || !/^[\p{L}\p{N} ._-]{1,100}$/u.test(title)) {
    throw new Error('[internal] Invalid theme identity')
  }
  try {
    await assertSafeDirectory(sitePath)
    const themesPath = join(sitePath, 'wp-content', 'themes')
    await assertSafeDirectory(themesPath)
    const themePath = join(themesPath, themeSlug)
    await assertContainedPath(themesPath, themePath)
    const files: Record<string, string> = {
      'style.css': `/*\nTheme Name: ${title}\nVersion: 1.0.0\nText Domain: ${themeSlug}\nRequires at least: 6.6\nRequires PHP: 7.4\nLicense: GPL-2.0-or-later\n*/\n`,
      'functions.php': `<?php\ndefined('ABSPATH') || exit;\nrequire_once get_template_directory() . '/inc/setup.php';\n`,
      'inc/setup.php': `<?php\ndefined('ABSPATH') || exit;\nadd_action('after_setup_theme', function () {\n    load_theme_textdomain('${themeSlug}', get_template_directory() . '/languages');\n    add_theme_support('wp-block-styles');\n    add_theme_support('editor-styles');\n    add_editor_style(array('assets/css/base.css', 'assets/css/layout.css'));\n});\nadd_action('wp_enqueue_scripts', function () {\n    wp_enqueue_style('${themeSlug}-base', get_theme_file_uri('assets/css/base.css'), array(), '1.0.0');\n    wp_enqueue_style('${themeSlug}-layout', get_theme_file_uri('assets/css/layout.css'), array('${themeSlug}-base'), '1.0.0');\n});\n`,
      'theme.json': JSON.stringify({ version: 3, settings: { appearanceTools: true, layout: { contentSize: '760px', wideSize: '1200px' }, color: { palette: [{ slug: 'ink', name: 'Ink', color: '#172d2b' }, { slug: 'paper', name: 'Paper', color: '#f5f3eb' }, { slug: 'accent', name: 'Accent', color: '#d7ee93' }] }, typography: { fontFamilies: [{ slug: 'system', name: 'System', fontFamily: 'system-ui, sans-serif' }] } }, styles: { color: { background: 'var:preset|color|paper', text: 'var:preset|color|ink' }, typography: { fontFamily: 'var:preset|font-family|system', lineHeight: '1.6' }, spacing: { blockGap: '1.5rem' } }, templateParts: [{ name: 'header', title: 'Header', area: 'header' }, { name: 'footer', title: 'Footer', area: 'footer' }] }, null, 2) + '\n',
      'parts/header.html': '<!-- wp:group {"tagName":"header","className":"site-header","layout":{"type":"constrained"}} -->\n<header class="wp-block-group site-header"><!-- wp:site-title /--></header>\n<!-- /wp:group -->\n',
      'parts/footer.html': '<!-- wp:group {"tagName":"footer","className":"site-footer","layout":{"type":"constrained"}} -->\n<footer class="wp-block-group site-footer"><!-- wp:paragraph --><p>Open Mercato · WordPress Studio</p><!-- /wp:paragraph --></footer>\n<!-- /wp:group -->\n',
      'templates/index.html': `<!-- wp:template-part {"slug":"header","theme":"${themeSlug}"} /-->\n<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->\n<main class="wp-block-group"><!-- wp:query {"query":{"perPage":10,"postType":"post","inherit":true}} --><div class="wp-block-query"><!-- wp:post-template --><!-- wp:post-title {"isLink":true} /--><!-- wp:post-excerpt /--><!-- /wp:post-template --><!-- wp:query-pagination --><!-- wp:query-pagination-previous /--><!-- wp:query-pagination-next /--><!-- /wp:query-pagination --></div><!-- /wp:query --></main>\n<!-- /wp:group -->\n<!-- wp:template-part {"slug":"footer","theme":"${themeSlug}"} /-->\n`,
      'templates/front-page.html': `<!-- wp:template-part {"slug":"header","theme":"${themeSlug}"} /-->\n<!-- wp:group {"tagName":"main","className":"site-main","layout":{"type":"constrained"}} -->\n<main class="wp-block-group site-main"><!-- wp:paragraph {"className":"eyebrow"} --><p class="eyebrow">OPEN MERCATO / WORDPRESS STUDIO</p><!-- /wp:paragraph --><!-- wp:heading {"level":1} --><h1 class="wp-block-heading">A fresh start.<br>A space of our own.</h1><!-- /wp:heading --><!-- wp:paragraph --><p>A new WordPress website built with independent Open Mercato tools. Ready for the next idea.</p><!-- /wp:paragraph --><!-- wp:separator --><hr class="wp-block-separator has-alpha-channel-opacity"/><!-- /wp:separator --><!-- wp:heading --><h2 class="wp-block-heading">Made to grow</h2><!-- /wp:heading --><!-- wp:paragraph --><p>Native blocks, a lightweight theme and a clear foundation for what comes next.</p><!-- /wp:paragraph --></main>\n<!-- /wp:group -->\n<!-- wp:template-part {"slug":"footer","theme":"${themeSlug}"} /-->\n`,
      'assets/css/base.css': 'html { scroll-behavior: smooth; }\nbody { margin: 0; }\na { color: inherit; text-underline-offset: .2em; }\na:focus-visible { outline: 3px solid currentColor; outline-offset: 4px; }\nh1, h2 { line-height: 1.1; letter-spacing: -.04em; }\nh1 { font-size: clamp(2.5rem, 7vw, 5rem); }\n@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }\n',
      'assets/css/layout.css': '.site-header, .site-footer { padding: 2rem max(1.5rem, 5vw); }\n.site-header { border-bottom: 1px solid currentColor; }\n.site-main { padding: 5rem 1.5rem; min-height: 55vh; }\n.site-footer { border-top: 1px solid currentColor; }\n.eyebrow { font-size: .875rem; letter-spacing: .12em; }\n',
    }
    await mkdir(themePath, { mode: 0o700 })
    for (const directory of ['inc', 'parts', 'templates', 'assets', 'assets/css']) {
      await mkdir(join(themePath, directory), { mode: 0o700 })
    }
    for (const [relativePath, content] of Object.entries(files)) {
      await writeFile(join(themePath, relativePath), content, { flag: 'wx', mode: 0o600 })
    }
    return { themePath, files: Object.keys(files).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)) }
  } catch {
    throw new Error('[internal] Theme scaffold failed')
  }
}
