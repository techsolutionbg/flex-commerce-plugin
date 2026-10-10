<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Illuminate\Database\Connection;
use Illuminate\Database\Eloquent\Model;

final class PublicCatalog
{
    public const PER_PAGE = 12;

    private Connection $db;
    public function __construct(?Connection $db = null)
    {
        $this->db = $db ?? Model::resolveConnection();
    }
    public function categories(): array
    {
        return $this->db->table('flex_commerce_categories')->where('status', 'active')->whereNull('deleted_at')->orderBy('name')->get(['id', 'name', 'slug'])->map(static fn($row) => (array) $row)->all();
    }
    public function topProducts(int $limit = 8): array
    {
        if (!$this->db->getSchemaBuilder()->hasColumn('flex_commerce_products', 'is_top')) return [];
        $rows = $this->db->table('flex_commerce_products')->where('is_top', true)->where('status', 'active')->whereNull('deleted_at')->orderByDesc('id')->limit(max(1, min(24, $limit)))->get();
        return $this->records($rows->all(), true);
    }
    public function bestsellers(int $limit = 8): array
    {
        if (!$this->db->getSchemaBuilder()->hasTable('flex_commerce_sales')) return [];
        $totals = $this->db->table('flex_commerce_sales')->where('cancelled', false)->select('product_id')->selectRaw('SUM(quantity) AS sold')->groupBy('product_id');
        $rows = $this->db->table('flex_commerce_products as p')->joinSub($totals, 'sales', 'sales.product_id', '=', 'p.id')->where('p.status', 'active')->whereNull('p.deleted_at')->select('p.*')->orderByDesc('sales.sold')->orderBy('p.id')->limit(max(1, min(24, $limit)))->get();
        return $this->records($rows->all(), true);
    }
    public function favourites(mixed $ids): array
    {
        if (!is_string($ids) || strlen($ids) > 12000 || ($ids !== '' && !preg_match('/^[1-9][0-9]*(?:,[1-9][0-9]*)*$/D', $ids))) {
            throw new CommerceException('Невалиден списък с любими продукти.', 422);
        }
        $list = $ids === '' ? [] : array_values(array_unique(explode(',', $ids)));
        if (count($list) > 1000) throw new CommerceException('До 1000 любими продукта.', 422);
        $rows = $this->db->table('flex_commerce_products')->whereIn('id', $list)->where('status', 'active')->whereNull('deleted_at')->get()->keyBy('id');
        $ordered = [];
        foreach ($list as $id) if ($row = $rows->get($id)) $ordered[] = $row;
        return $this->records($ordered, true);
    }
    public function category(string $slug): array
    {
        foreach ($this->categories() as $category) {
            if ($category['slug'] === $slug) {
                return $category;
            }
        }
        throw new CommerceException('Категорията не е намерена.', 404);
    }
    public function listing(array $filters = [], ?string $categorySlug = null): array
    {
        $q = $filters['q'] ?? '';
        $sort = $filters['sort'] ?? 'newest';
        $stock = $filters['stock'] ?? '';
        $sale = $filters['sale'] ?? '';
        $page = filter_var($filters['page'] ?? 1, FILTER_VALIDATE_INT);
        $minPrice = $this->filterMoney($filters['min_price'] ?? '');
        $maxPrice = $this->filterMoney($filters['max_price'] ?? '');
        if (!is_string($q) || mb_strlen($q) > 150 || !in_array($sort, ['newest', 'name', 'price_asc', 'price_desc'], true) || !in_array($stock, ['', '1'], true) || !in_array($sale, ['', '1'], true) || !is_int($page) || $page < 1 || $page > 100000) {
            throw new CommerceException('Невалидни филтри за каталога.', 422);
        }
        if ($minPrice !== null && $maxPrice !== null && $minPrice > $maxPrice) {
            throw new CommerceException('Минималната цена не може да е по-висока от максималната.', 422);
        }
        $category = $categorySlug === null ? null : $this->category($categorySlug);
        $query = $this->db->table('flex_commerce_products')->where('status', 'active')->whereNull('deleted_at');
        $q = trim($q);
        if ($q !== '') {
            // Bind a literal search term; wildcard characters are not query operators.
            $needle = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
            $query->whereRaw("(name LIKE ? ESCAPE '!' OR sku LIKE ? ESCAPE '!')", [$needle, $needle]);
        }
        if ($category) {
            $query->whereJsonContains('category_ids', (int) $category['id']);
        }
        $priceExpression = 'COALESCE(sale_price_minor, price_minor)';
        $boundsRow = (clone $query)->selectRaw('MIN(' . $priceExpression . ') as min_minor, MAX(' . $priceExpression . ') as max_minor')->first();
        if ($stock === '1') {
            $query->where('stock', '>', 0);
        }
        if ($sale === '1') {
            $query->whereNotNull('sale_price_minor')->whereColumn('sale_price_minor', '<', 'price_minor');
        }
        if ($minPrice !== null) {
            $query->whereRaw($priceExpression . ' >= ?', [$minPrice]);
        }
        if ($maxPrice !== null) {
            $query->whereRaw($priceExpression . ' <= ?', [$maxPrice]);
        }
        $total = (clone $query)->count();
        $perPage = self::PER_PAGE;
        $pages = max(1, (int) ceil($total / $perPage));
        if ($page > $pages) {
            throw new CommerceException('Страницата не е намерена.', 404);
        }
        match ($sort) {
            'name' => $query->orderBy('name')->orderBy('id'),
            'price_asc' => $query->orderBy('currency')->orderByRaw($priceExpression . ' ASC')->orderBy('id'),
            'price_desc' => $query->orderBy('currency')->orderByRaw($priceExpression . ' DESC')->orderBy('id'),
            default => $query->orderByDesc('id'),
        };
        $rows = $query->offset(($page - 1) * $perPage)->limit($perPage)->get();
        $active = [
            'q' => $q,
            'sort' => $sort,
            'stock' => $stock,
            'sale' => $sale,
            'min_price' => $minPrice === null ? '' : number_format($minPrice / 100, 2, '.', ''),
            'max_price' => $maxPrice === null ? '' : number_format($maxPrice / 100, 2, '.', ''),
        ];
        $from = $total === 0 ? 0 : (($page - 1) * $perPage) + 1;
        $to = min($total, $page * $perPage);
        return [
            'products' => $this->records($rows->all(), true),
            'categories' => $this->categories(),
            'category' => $category,
            'total' => $total,
            'page' => $page,
            'pages' => $pages,
            'per_page' => $perPage,
            'from' => $from,
            'to' => $to,
            'filters' => $active,
            'price_bounds' => [
                'min' => isset($boundsRow->min_minor) ? number_format(((int) $boundsRow->min_minor) / 100, 2, '.', '') : '',
                'max' => isset($boundsRow->max_minor) ? number_format(((int) $boundsRow->max_minor) / 100, 2, '.', '') : '',
            ],
        ];
    }

    private function filterMoney(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (!is_string($value) && !is_int($value) && !is_float($value)) {
            throw new CommerceException('Невалидни филтри за каталога.', 422);
        }
        $normalized = str_replace(',', '.', trim((string) $value));
        if ($normalized === '') {
            return null;
        }
        if (!preg_match('/^\d{1,8}(?:\.\d{1,2})?$/D', $normalized)) {
            throw new CommerceException('Невалидна цена във филтрите.', 422);
        }

        return (int) round((float) $normalized * 100);
    }
    public function product(string $slug): array
    {
        $row = $this->db->table('flex_commerce_products')->where('slug', $slug)->where('status', 'active')->whereNull('deleted_at')->first();
        if (!$row) {
            throw new CommerceException('Продуктът не е намерен.', 404);
        }
        $record = $this->records([$row])[0];
        $ids = json_decode($row->category_ids, true) ?? [];
        $record['stock'] = max(0, (int) $row->stock);
        $record['categories'] = array_values(array_filter($this->categories(), static fn($category) => in_array((int) $category['id'], $ids, true)));
        return $record;
    }
    private function records(array $rows, bool $previewOnly = false): array
    {
        $ids = [];
        foreach ($rows as $row) {
            $ids = [...$ids, ...(json_decode($row->images, true) ?? [])];
        }
        $media = $ids ? $this->db->table('media')->whereIn('id', array_unique($ids))->whereNull('deleted_at')->where('mime', 'like', 'image/%')->get()->keyBy('id') : collect();
        return array_map(static function ($row) use ($media, $previewOnly): array {
            $images = [];
            $details = json_decode($row->image_details ?? '{}', true) ?? [];
            foreach (json_decode($row->images, true) ?? [] as $id) {
                $m = $media->get($id);
                if (!$m) {
                    continue;
                }
                $text = $details[$id] ?? [];
                $images[] = ['id' => (int) $id, 'url' => '/media-files/' . $id . '/original', 'thumbnail_url' => empty($m->thumbnail_path) ? null : '/media-files/' . $id . '/thumbnail', 'alt' => $text['alt'] ?? $m->alt ?? '', 'title' => $text['title'] ?? $m->title ?? '', 'caption' => $text['caption'] ?? $m->caption ?? '', 'description' => $text['description'] ?? $m->description ?? '', 'link' => $text['link'] ?? ''];
                if ($previewOnly) {
                    break;
                }
            }
            $regular = (int) $row->price_minor;
            $sale = isset($row->sale_price_minor) ? (int) $row->sale_price_minor : null;
            $onSale = $sale !== null && $sale < $regular;
            $minor = $onSale ? $sale : $regular;
            return ['id' => (int) $row->id, 'name' => $row->name, 'slug' => $row->slug, 'sku' => $row->sku, 'description' => $previewOnly ? '' : $row->description, 'excerpt' => mb_substr(trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags(preg_replace('/<(script|style)\b[^>]*>.*?<\/\1>/is', '', preg_replace('/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/i', ' ', (string) $row->description))), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? ''), 0, 320), 'on_sale' => $onSale, 'regular_price' => number_format($regular / 100, 2, ',', ' '), 'discount_percent' => $onSale ? (int) round(($regular - $minor) * 100 / $regular) : 0, 'price' => number_format($minor / 100, 2, ',', ' '), 'price_minor' => $minor, 'currency' => $row->currency, 'available' => (int) $row->stock > 0, 'images' => $images];
        }, $rows);
    }
}
