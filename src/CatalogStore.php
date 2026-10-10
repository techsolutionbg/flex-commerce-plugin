<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Illuminate\Database\Connection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;

final class CatalogStore
{
    private Connection $db;
    public function __construct(?Connection $db = null)
    {
        $this->db = $db ?? Model::resolveConnection();
    }
    public function install(): void
    {
        if (!$this->db->getSchemaBuilder()->hasTable('flex_commerce_sales')) {
            $this->db->getSchemaBuilder()->create('flex_commerce_sales', static function (Blueprint $t): void {
                $t->increments('id');
                $t->unsignedInteger('product_id');
                $t->string('reference', 100);
                $t->unsignedInteger('quantity');
                $t->boolean('cancelled')->default(false);
                $t->timestamp('created_at');
                $t->unique(['reference', 'product_id']);
                $t->index(['cancelled', 'product_id']);
            });
        }
        if (!$this->db->getSchemaBuilder()->hasTable('flex_commerce_settings')) {
            $this->db->getSchemaBuilder()->create('flex_commerce_settings', static function (Blueprint $t): void {
                $t->unsignedInteger('id')->primary();
                $t->text('values');
                $t->unsignedInteger('version')->default(1);
            });
            $this->db->table('flex_commerce_settings')->insert(['id' => 1, 'values' => '{}', 'version' => 1]);
        }
        foreach (['products', 'categories'] as $kind) {
            if ($this->db->getSchemaBuilder()->hasTable($this->table($kind))) {
                continue;
            }
            $this->db->getSchemaBuilder()->create($this->table($kind), static function (Blueprint $t) use ($kind): void {
                $t->increments('id');
                $t->string('name', 190);
                $t->string('slug', 190)->unique();
                $t->text('description');
                $t->string('status', 16);
                $t->unsignedInteger('version')->default(1);
                if ($kind === 'products') {
                    $t->string('sku', 100)->nullable()->unique();
                    $t->unsignedBigInteger('price_minor');
                    $t->string('currency', 3)->default('EUR');
                    $t->unsignedInteger('stock');
                    $t->text('images');
                    $t->text('image_details')->nullable();
                    $t->text('category_ids');
                }
                $t->timestamps();
                $t->softDeletes();
            });
        }
        if (!$this->db->getSchemaBuilder()->hasColumn($this->table('products'), 'primary_image_id')) {
            $this->db->getSchemaBuilder()->table($this->table('products'), static function (Blueprint $t): void {
                $t->unsignedInteger('primary_image_id')->nullable();
            });
            foreach ($this->db->table($this->table('products'))->get(['id', 'images']) as $product) {
                $images = json_decode($product->images, true) ?? [];
                $this->db->table($this->table('products'))->where('id', $product->id)->update(['primary_image_id' => $images[0] ?? null]);
            }
        }
        if (!$this->db->getSchemaBuilder()->hasColumn($this->table('products'), 'is_top')) {
            $this->db->getSchemaBuilder()->table($this->table('products'), static function (Blueprint $t): void {
                $t->boolean('is_top')->default(false);
            });
        }
        if (!$this->db->getSchemaBuilder()->hasColumn($this->table('products'), 'sale_price_minor')) {
            $this->db->getSchemaBuilder()->table($this->table('products'), static function (Blueprint $t): void {
                $t->unsignedBigInteger('sale_price_minor')->nullable();
            });
        }
        if (!$this->db->getSchemaBuilder()->hasColumn($this->table('products'), 'image_details')) {
            $this->db->getSchemaBuilder()->table($this->table('products'), static function (Blueprint $t): void {
                $t->text('image_details')->nullable();
            });
        }
    }
    public function settings(): array
    {
        $row = $this->db->table('flex_commerce_settings')->where('id', 1)->first();
        return array_replace([
            'currency' => 'EUR',
            'default_stock' => 0,
            'default_status' => 'draft',
            'product_page_layout' => 'plain',
            'checkout_enabled' => true,
            'cod_enabled' => true,
            'shipping_mode' => 'fixed',
            'shipping_minor' => 500,
            'free_shipping_minor' => 0,
            'order_email_customer' => true,
            'order_admin_email' => '',
            'terms_url' => '',
            'privacy_url' => '',
            'shipping_terms_url' => '',
        ], json_decode($row->values, true) ?? [], ['version' => (int) $row->version]);
    }
    public function saveSettings(array $input): array
    {
        $currency = $input['currency'] ?? null;
        $status = $input['default_status'] ?? null;
        $layout = $input['product_page_layout'] ?? $this->settings()['product_page_layout'];
        $stock = filter_var($input['default_stock'] ?? null, FILTER_VALIDATE_INT);
        if (!in_array($layout, ['plain', 'boxed'], true) || !in_array($currency, ['EUR', 'BGN', 'USD'], true) || !in_array($status, ['active', 'inactive', 'draft'], true) || !is_int($stock) || $stock < 0 || $stock > 1000000) {
            throw new CommerceException('Невалидни настройки на магазина.', 422);
        }
        $extras = [];
        foreach (['checkout_enabled','cod_enabled','order_email_customer'] as $key) {
            $extras[$key] = $input[$key] ?? $this->settings()[$key];
            if (!is_bool($extras[$key])) throw new CommerceException('Невалидна настройка.', 422);
        }
        $shippingMode = $input['shipping_mode'] ?? $this->settings()['shipping_mode'] ?? 'fixed';
        if (!in_array($shippingMode, ['fixed', 'econt'], true)) {
            throw new CommerceException('Невалиден режим на доставка.', 422);
        }
        $extras['shipping_mode'] = $shippingMode;
        foreach (['shipping_minor','free_shipping_minor'] as $key) {
            $value = filter_var($input[$key] ?? $this->settings()[$key], FILTER_VALIDATE_INT);
            if (!is_int($value) || $value < 0 || $value > 100000000) throw new CommerceException('Невалидна сума за доставка.', 422);
            $extras[$key] = $value;
        }
        foreach (['order_admin_email','terms_url','privacy_url','shipping_terms_url'] as $key) {
            $value = $input[$key] ?? $this->settings()[$key];
            if (!is_string($value) || mb_strlen($value)>300) throw new CommerceException('Невалиден адрес.', 422);
            $value=trim($value);
            if ($key !== 'order_admin_email' && $value !== '' && (str_contains($value, chr(92)) || preg_match('/[\x00-\x20]/', $value) || preg_match('/%(?:0[0-9a-f]|1[0-9a-f]|20|5c|7f)/i', $value) || (!str_starts_with($value, '/') && !filter_var($value, FILTER_VALIDATE_URL)))) {
                throw new CommerceException('Невалиден HTTP/HTTPS адрес.', 422);
            }
            if ($value !== '' && ($key === 'order_admin_email' ? !filter_var($value,FILTER_VALIDATE_EMAIL) : !preg_match('~^(?:/(?!/)|https?://)~i',$value))) throw new CommerceException('Невалиден имейл или HTTP/HTTPS адрес.',422);
            $extras[$key]=$value;
        }
        return $this->db->transaction(function () use ($input, $currency, $status, $stock, $layout, $extras): array {
            $row = $this->db->table('flex_commerce_settings')->where('id', 1)->lockForUpdate()->first();
            if ((int) ($input['version'] ?? 0) !== (int) $row->version) {
                throw new CommerceException('Настройките са променени. Презаредете страницата.', 409);
            }
            $this->db->table('flex_commerce_settings')->where('id', 1)->update(['values' => json_encode($extras + ['currency' => $currency, 'default_stock' => $stock, 'default_status' => $status, 'product_page_layout' => $layout]), 'version' => (int) $row->version + 1]);
            return $this->settings();
        });
    }
    private function table(string $kind): string
    {
        if (!in_array($kind, ['products', 'categories'], true)) {
            throw new CommerceException('Невалиден тип запис.', 422);
        }
        return 'flex_commerce_' . $kind;
    }
    public function index(string $kind, string $view = 'active'): array
    {
        if (!in_array($view, ['active', 'trash'], true)) {
            throw new CommerceException('Невалиден изглед.', 422);
        }
        $q = $this->db->table($this->table($kind));
        if ($kind === 'products') {
            $totals = $this->db->table('flex_commerce_sales')->where('cancelled', false)->select('product_id')->selectRaw('SUM(quantity) AS sold')->groupBy('product_id');
            $q->leftJoinSub($totals, 'sales', 'sales.product_id', '=', 'flex_commerce_products.id')->select('flex_commerce_products.*')->selectRaw('COALESCE(sales.sold, 0) AS sold');
        }
        $view === 'trash' ? $q->whereNotNull('deleted_at') : $q->whereNull('deleted_at');
        return $q->orderByDesc($this->table($kind) . '.id')->get()->map(fn($row) => $this->record($row))->all();
    }
    public function get(string $kind, int $id): array
    {
        $row = $this->db->table($this->table($kind))->where('id', $id)->first();
        if (!$row) {
            throw new CommerceException('Записът не е намерен.', 404);
        }
        if ($kind === 'products') $row->sold = (int) $this->db->table('flex_commerce_sales')->where('product_id', $id)->where('cancelled', false)->sum('quantity');
        return $this->record($row);
    }
    private function text(mixed $value, int $max, string $label): string
    {
        if (!is_string($value) || mb_strlen($value) > $max) {
            throw new CommerceException('Невалидна стойност за ' . $label . '.', 422);
        }
        return trim($value);
    }
    public static function price(mixed $value): int
    {
        if (!is_string($value) || !preg_match('/^(0|[1-9][0-9]{0,6})(?:[.,]([0-9]{1,2}))?$/D', $value, $m)) {
            throw new CommerceException('Цената трябва да е положителна сума с до две цифри след десетичния знак.', 422);
        }
        return ((int) $m[1] * 100) + (int) str_pad($m[2] ?? '', 2, '0');
    }
    private function ids(mixed $value): array
    {
        if (!is_array($value) || count($value) > 200) {
            throw new CommerceException('Невалиден списък.', 422);
        }
        $ids = [];
        foreach ($value as $id) {
            $n = filter_var($id, FILTER_VALIDATE_INT);
            if (!is_int($n) || $n < 1) {
                throw new CommerceException('Невалиден идентификатор.', 422);
            }
            $ids[] = $n;
        }
        return array_values(array_unique($ids));
    }
    public function save(string $kind, array $input, ?int $id = null): array
    {
        $table = $this->table($kind);
        $name = $this->text($input['name'] ?? '', 190, 'име');
        if ($name === '') {
            throw new CommerceException('Въведете име.', 422);
        }
        $slug = $this->text($input['slug'] ?? '', 190, 'идентификатор');
        $generated = $slug === '';
        if ($generated) {
            $slug = trim(substr(preg_replace('/[^a-z0-9]+/', '-', transliterator_transliterate('Any-Latin; Latin-ASCII; Lower()', $name)), 0, 170), '-') ?: $kind;
        }
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $slug)) {
            throw new CommerceException('Невалиден идентификатор.', 422);
        }
        $defaults = $kind === 'products' ? $this->settings() : ['default_status' => 'draft'];
        $status = $input['status'] ?? $defaults['default_status'];
        if (!in_array($status, ['active', 'inactive', 'draft'], true)) {
            throw new CommerceException('Невалиден статус.', 422);
        }
        $values = ['name' => $name, 'slug' => $slug, 'status' => $status, 'description' => $this->text($input['description'] ?? '', 50000, 'описание')];
        if ($kind === 'products') {
            $top = $input['is_top'] ?? ($id ? $this->get($kind, $id)['is_top'] : false);
            if (!is_bool($top)) throw new CommerceException('Невалидна стойност за топ продукт.', 422);
            $values['is_top'] = $top;
            $stock = filter_var($input['stock'] ?? $defaults['default_stock'], FILTER_VALIDATE_INT);
            if (!is_int($stock) || $stock < 0 || $stock > 1000000) {
                throw new CommerceException('Наличността трябва да е цяло число от 0 до 1000000.', 422);
            }
            $currency = $input['currency'] ?? $defaults['currency'];
            if (!in_array($currency, ['EUR', 'BGN', 'USD'], true)) {
                throw new CommerceException('Невалидна валута.', 422);
            }
            $images = $this->ids($input['images'] ?? []);
            $primary = array_key_exists('primary_image_id', $input) ? $input['primary_image_id'] : ($id ? $this->get($kind, $id)['primary_image_id'] : ($images[0] ?? null));
            if ($primary !== null && ((!is_int($primary) && !is_string($primary)) || !in_array(filter_var($primary, FILTER_VALIDATE_INT), $images, true))) throw new CommerceException('Основното изображение трябва да е сред избраните изображения.', 422);
            $primary = $primary === null ? null : (int) $primary;
            if ($primary !== null) $images = [$primary, ...array_values(array_filter($images, static fn($image) => $image !== $primary))];
            $values['primary_image_id'] = $primary;
            $categories = $this->ids($input['category_ids'] ?? []);
            if ($images && $this->db->table('media')->whereIn('id', $images)->whereNull('deleted_at')->where('mime', 'like', 'image/%')->count() !== count($images)) {
                throw new CommerceException('Изберете налични изображения от медийната библиотека.', 422);
            }
            // Existing links to trashed categories remain editable; new links must be available.
            $existing = $id ? $this->get($kind, $id)['category_ids'] : [];
            foreach ($categories as $category) {
                $q = $this->db->table($this->table('categories'))->where('id', $category);
                if (!in_array($category, $existing, true)) {
                    $q->whereNull('deleted_at');
                }
                if (!$q->exists()) {
                    throw new CommerceException('Категорията не е налична.', 422);
                }
            }
            $details = $input['image_details'] ?? ($id ? $this->get($kind, $id)['image_details'] : []);
            if (!is_array($details) || count($details) > 200) {
                throw new CommerceException('Невалидни настройки на изображенията.', 422);
            }
            $prepared = [];
            foreach ($images as $mediaId) {
                $media = $this->db->table('media')->where('id', $mediaId)->first();
                $item = $details[$mediaId] ?? [];
                if (!is_array($item)) {
                    throw new CommerceException('Невалидни настройки на изображението.', 422);
                }
                foreach (['alt' => 500, 'caption' => 1000, 'title' => 500, 'link' => 2000, 'description' => 3000] as $field => $max) {
                    $default = $field === 'link' ? '' : mb_substr((string) ($media->{$field} ?? ''), 0, $max);
                    $prepared[$mediaId][$field] = $this->text($item[$field] ?? $default, $max, $field);
                }
                $link = $prepared[$mediaId]['link'];
                if ($link !== '' && (!preg_match('~^(?:/(?!/)|https?://)~i', $link) || (str_contains($link, chr(92)) || preg_match('/[\x00-\x20]/', $link)) || (str_starts_with($link, 'http') && !filter_var($link, FILTER_VALIDATE_URL)))) {
                    throw new CommerceException('Връзката трябва да е локален адрес или HTTP/HTTPS URL.', 422);
                }
            }
            $values['image_details'] = json_encode((object) $prepared);
            $regular = self::price($input['price'] ?? '');
            $saleInput = $input['sale_price'] ?? ($id ? $this->get($kind, $id)['sale_price'] : '');
            $sale = $saleInput === '' || $saleInput === null ? null : self::price($saleInput);
            if ($sale !== null && $sale >= $regular) {
                throw new CommerceException('Промоционалната цена трябва да е по-ниска от редовната.', 422);
            }
            $values['sale_price_minor'] = $sale;
            $sku = $this->text($input['sku'] ?? '', 100, 'SKU');
            $values += ['sku' => $sku ?: null, 'price_minor' => self::price($input['price'] ?? ''), 'currency' => $currency, 'stock' => $stock, 'images' => json_encode($images), 'category_ids' => json_encode($categories)];
        }
        return $this->db->transaction(function () use ($kind, $table, $values, $input, $id, $generated): array {
            if ($id) {
                $row = $this->locked($kind, $id, $input['version'] ?? null);
                if ($row->deleted_at !== null) {
                    throw new CommerceException('Възстановете записа преди редактиране.', 409);
                }
            }
            $slug = $values['slug'];
            $suffix = 2;
            while ($this->db->table($table)->where('slug', $values['slug'])->when($id, fn($q) => $q->where('id', '!=', $id))->exists()) {
                if (!$generated) {
                    throw new CommerceException('Идентификаторът вече се използва.', 409);
                }
                $values['slug'] = $slug . '-' . $suffix++;
            }
            if ($kind === 'products' && $values['sku'] !== null && $this->db->table($table)->where('sku', $values['sku'])->when($id, fn($q) => $q->where('id', '!=', $id))->exists()) {
                throw new CommerceException('SKU вече се използва.', 409);
            }
            $values['updated_at'] = gmdate('Y-m-d H:i:s');
            $values['version'] = $id ? (int) $row->version + 1 : 1;
            if ($id) {
                $this->db->table($table)->where('id', $id)->update($values);
            } else {
                $values['created_at'] = $values['updated_at'];
                $id = $this->db->table($table)->insertGetId($values);
            }
            return $this->get($kind, $id);
        });
    }
    private function locked(string $kind, int $id, mixed $version): object
    {
        $row = $this->db->table($this->table($kind))->where('id', $id)->lockForUpdate()->first();
        if (!$row) {
            throw new CommerceException('Записът не е намерен.', 404);
        }
        if (filter_var($version, FILTER_VALIDATE_INT) !== (int) $row->version) {
            throw new CommerceException('Записът е променен в друг таб. Презаредете данните.', 409);
        }
        return $row;
    }
    public function action(string $kind, int $id, string $action, mixed $version): void
    {
        $this->db->transaction(function () use ($kind, $id, $action, $version): void {
            $row = $this->locked($kind, $id, $version);
            $table = $this->table($kind);
            if ($action === 'force') {
                if ($row->deleted_at === null) {
                    throw new CommerceException('Първо преместете записа в кошчето.', 409);
                }
                if ($kind === 'categories') {
                    foreach ($this->db->table($this->table('products'))->get() as $product) {
                        $ids = json_decode($product->category_ids, true);
                        if (in_array($id, $ids, true)) {
                            throw new CommerceException('Категорията е свързана с продукт. Премахнете връзката първо.', 409);
                        }
                    }
                }
                $this->db->table($table)->where('id', $id)->delete();
                return;
            }
            if (!in_array($action, ['trash', 'restore'], true)) {
                throw new CommerceException('Невалидно действие.', 422);
            }
            if (($action === 'trash') === ($row->deleted_at !== null)) {
                throw new CommerceException('Записът вече е в този изглед.', 409);
            }
            $this->db->table($table)->where('id', $id)->update(['deleted_at' => $action === 'trash' ? gmdate('Y-m-d H:i:s') : null, 'version' => (int) $row->version + 1, 'updated_at' => gmdate('Y-m-d H:i:s')]);
        });
    }
    private function record(object $row): array
    {
        $r = (array) $row;
        $r['id'] = (int) $row->id;
        $r['version'] = (int) $row->version;
        if (isset($r['price_minor'])) {
            $r['primary_image_id'] = isset($row->primary_image_id) ? (int) $row->primary_image_id : null;
            $r['is_top'] = (bool) ($row->is_top ?? false);
            $r['sold'] = (int) ($row->sold ?? 0);
            $r['price_minor'] = (int) $r['price_minor'];
            $r['sale_price_minor'] = isset($r['sale_price_minor']) ? (int) $r['sale_price_minor'] : null;
            $r['sale_price'] = $r['sale_price_minor'] === null ? '' : number_format($r['sale_price_minor'] / 100, 2, '.', '');
            $r['stock'] = (int) $r['stock'];
            $r['price'] = intdiv($r['price_minor'], 100) . '.' . str_pad((string) ($r['price_minor'] % 100), 2, '0', STR_PAD_LEFT);
            $r['images'] = json_decode($r['images'], true);
            $r['image_details'] = json_decode($r['image_details'] ?? '{}', true) ?? [];
            $r['category_ids'] = json_decode($r['category_ids'], true);
            $r['media'] = $r['images'] ? $this->db->table('media')->whereIn('id', $r['images'])->whereNull('deleted_at')->get()->map(fn($m) => ['id' => (int) $m->id, 'title' => $m->title, 'alt' => $m->alt ?? '', 'caption' => $m->caption ?? '', 'description' => $m->description ?? '', 'thumbnail_url' => empty($m->thumbnail_path) ? null : '/media-files/' . $m->id . '/thumbnail', 'url' => '/media-files/' . $m->id . '/original'])->all() : [];
        }
        return $r;
    }
}
