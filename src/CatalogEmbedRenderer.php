<?php

declare(strict_types=1);

namespace Flex\Commerce;

final class CatalogEmbedRenderer
{
    public function __construct(private ?PublicCatalog $catalog = null) {}

    public function content(string $html): string
    {
        if (!str_contains($html, '[commerce_catalog]')) {
            return $html;
        }
        $document = new \DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);
        try {
            $document->loadHTML('<?xml encoding="UTF-8"><div id="flex-content-root">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
            $xpath = new \DOMXPath($document);
            $nodes = $xpath->query('//text()[not(ancestor::script or ancestor::style or ancestor::pre or ancestor::code)]');
            $rendered = false;
            foreach (iterator_to_array($nodes ?: []) as $node) {
                $text = $node->nodeValue ?? '';
                if (!preg_match_all('/\[commerce_catalog\]/', $text, $matches, PREG_OFFSET_CAPTURE)) {
                    continue;
                }
                $fragment = $document->createDocumentFragment();
                $cursor = 0;
                foreach ($matches[0] as $index => [$token, $offset]) {
                    $fragment->appendChild($document->createTextNode(substr($text, $cursor, $offset - $cursor)));
                    $markup = $this->render();
                    if ($markup !== '') {
                        $rendered = true;
                        $temporary = new \DOMDocument('1.0', 'UTF-8');
                        $temporary->loadHTML('<?xml encoding="UTF-8"><div id="catalog-markup">' . $markup . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
                        $wrapper = $temporary->getElementById('catalog-markup');
                        if ($wrapper) {
                            foreach (iterator_to_array($wrapper->childNodes) as $child) {
                                $fragment->appendChild($document->importNode($child, true));
                            }
                        }
                    }
                    $cursor = $offset + strlen($token);
                }
                $fragment->appendChild($document->createTextNode(substr($text, $cursor)));
                $parent = $node->parentNode;
                // Quill wraps shortcode-only lines in paragraphs. Replace the paragraph to keep valid HTML.
                if ($parent instanceof \DOMElement && $parent->tagName === 'p' && $parent->childNodes->length === 1 && trim($text) === $matches[0][0][0]) {
                    $parent->parentNode?->replaceChild($fragment, $parent);
                } else {
                    $parent?->replaceChild($fragment, $node);
                }
            }
            $root = $document->getElementById('flex-content-root');
            $result = '';
            if ($root) {
                foreach ($root->childNodes as $child) {
                    $result .= $document->saveHTML($child);
                }
            }
            if ($rendered) {
                $result = '<link rel="stylesheet" href="/extensions/flex/commerce/assets/assets/storefront.css"><script type="module" src="/extensions/flex/commerce/assets/assets/storefront.js"></script>' . $result;
            }
            return $result;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    public function bestsellers(): string
    {
        return $this->highlights(($this->catalog ?? new PublicCatalog())->bestsellers(), 'Най-продавани', 'commerce-bestsellers-heading');
    }
    public function topProducts(): string
    {
        return $this->highlights(($this->catalog ?? new PublicCatalog())->topProducts(), 'Топ продукти', 'commerce-top-products-heading', 'Специално подбрани продукти, които препоръчваме — открийте нашите акценти и идеи за следващата си покупка.');
    }
    private function highlights(array $products, string $title, string $headingId, string $description = ''): string
    {
        if (!$products) return '';
        $loader = new \Twig\Loader\FilesystemLoader(__DIR__ . '/../templates');
        $markup = (new \Twig\Environment($loader, ['cache' => false, 'strict_variables' => true, 'autoescape' => 'html']))->render('bestsellers.twig', ['products' => $products, 'title' => $title, 'heading_id' => $headingId, 'description' => $description]);
        return '<link rel="stylesheet" href="/extensions/flex/commerce/assets/assets/storefront.css?v=1"><div class="flex-commerce-storefront starter-bestsellers">' . $markup . '</div>';
    }
    public function render(): string
    {
        $data = ($this->catalog ?? new PublicCatalog())->listing([]);
        $base = '/catalog';
        $data['base_url'] = $base;
        $pageUrl = static function (int $page) use ($base): string {
            return $page > 1 ? $base . '?page=' . $page : $base;
        };
        $data['page_urls'] = [];
        for ($number = max(1, $data['page'] - 2); $number <= min($data['pages'], $data['page'] + 2); $number++) {
            $data['page_urls'][$number] = $pageUrl($number);
        }
        $data['first_url'] = $pageUrl(1);
        $data['last_url'] = $pageUrl($data['pages']);
        $data['previous_url'] = $pageUrl(max(1, $data['page'] - 1));
        $data['next_url'] = $pageUrl(min($data['pages'], $data['page'] + 1));
        $loader = new \Twig\Loader\FilesystemLoader(__DIR__ . '/../templates');
        $theme = (string) \Flex\Settings\Setting::query()->where('key', 'site.active_theme')->value('value');
        if (preg_match('/^[a-z0-9][a-z0-9._-]*$/', $theme) && is_dir($override = dirname(__DIR__, 4) . '/themes/' . $theme . '/commerce')) {
            $loader->prependPath($override);
        }
        $markup = (new \Twig\Environment($loader, ['cache' => false, 'strict_variables' => true, 'autoescape' => 'html']))->render('catalog.twig', $data);
        return '<div class="flex-commerce-storefront">' . $markup . '</div>';
    }
}
