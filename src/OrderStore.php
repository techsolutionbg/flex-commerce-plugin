<?php
declare(strict_types=1);
namespace Flex\Commerce;

use Flex\Extension\V1\ExtensionApiInterface;
use Illuminate\Database\Connection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;

final class OrderStore
{
    private Connection $db;
    public const STATUSES = ['new', 'processing', 'shipped', 'completed', 'cancelled'];
    public const METHOD_ADDRESS = 'address';

    public function __construct(private ?Connection $connection = null, private ?ExtensionApiInterface $extensions = null)
    {
        $this->db = $connection ?? Model::resolveConnection();
    }

    public function install(): void
    {
        $schema = $this->db->getSchemaBuilder();
        if (!$schema->hasTable('flex_commerce_orders')) $schema->create('flex_commerce_orders', static function (Blueprint $t): void {
            $t->increments('id'); $t->string('number', 40)->unique(); $t->string('request_key', 64)->unique();
            $t->string('status', 16)->default('new'); $t->string('payment_status', 16)->default('unpaid');
            $t->string('currency', 3); $t->unsignedBigInteger('subtotal_minor'); $t->unsignedBigInteger('shipping_minor'); $t->unsignedBigInteger('total_minor');
            $t->text('customer'); $t->text('items'); $t->text('history');
            $t->boolean('stock_restored')->default(false); $t->unsignedInteger('version')->default(1);
            $t->timestamp('notified_at')->nullable(); $t->timestamps(); $t->index(['status', 'created_at']);
        });
    }

    /**
     * @param array<int, int> $cart
     * @param array{shipping?: string, shipping_meta?: array<string, mixed>} $selection
     * @return array<string, mixed>
     */
    public function quote(array $cart, array $selection = []): array
    {
        if (!$cart || count($cart) > 100) throw new CommerceException('Количката е празна.', 422);
        ksort($cart, SORT_NUMERIC);
        $settings = (new CatalogStore($this->db))->settings();
        if (!$settings['checkout_enabled'] || !$settings['cod_enabled']) throw new CommerceException('Приемането на поръчки е временно спряно.', 503);
        $products = $this->db->table('flex_commerce_products')->whereIn('id', array_keys($cart))->where('status', 'active')->whereNull('deleted_at')->get()->keyBy('id');
        $items = []; $subtotal = 0;
        foreach ($cart as $id => $quantity) {
            if (!is_int($quantity) || $quantity < 1 || $quantity > 1000000) throw new CommerceException('Невалидно количество.', 422);
            $p = $products->get($id);
            if (!$p || $quantity > $p->stock) throw new CommerceException('Наличността е променена. Проверете количката.', 409);
            if ($p->currency !== $settings['currency']) throw new CommerceException('Всички продукти трябва да са в основната валута на магазина.', 422);
            $price = $p->sale_price_minor !== null && $p->sale_price_minor < $p->price_minor ? (int) $p->sale_price_minor : (int) $p->price_minor;
            $items[] = ['product_id' => (int) $p->id, 'name' => $p->name, 'sku' => $p->sku, 'quantity' => $quantity, 'price_minor' => $price, 'line_minor' => $price * $quantity];
            $subtotal += $price * $quantity;
        }
        $shippingFlat = $settings['free_shipping_minor'] > 0 && $subtotal >= $settings['free_shipping_minor'] ? 0 : $settings['shipping_minor'];
        $methodId = is_string($selection['shipping'] ?? null) && $selection['shipping'] !== '' ? $selection['shipping'] : self::METHOD_ADDRESS;
        $meta = is_array($selection['shipping_meta'] ?? null) ? $selection['shipping_meta'] : [];
        $methods = $this->shippingMethods(['cart' => $cart, 'settings' => $settings, 'selection' => $selection]);
        if (!in_array($methodId, array_column($methods, 'id'), true)) {
            $methodId = $methods[0]['id'] ?? self::METHOD_ADDRESS;
        }
        $data = [
            'items' => $items,
            'currency' => $settings['currency'],
            'subtotal_minor' => $subtotal,
            'shipping_minor' => $shippingFlat,
            'total_minor' => $subtotal + $shippingFlat,
            'payment' => 'cod',
            'shipping' => $methodId,
            'shipping_meta' => $meta,
            'methods' => $methods,
            'terms_url' => $settings['terms_url'],
            'privacy_url' => $settings['privacy_url'],
        ];
        $filtered = $this->extensions?->applyFilters('commerce.checkout.quote', $data, [
            'cart' => $cart,
            'selection' => ['shipping' => $methodId, 'shipping_meta' => $meta],
            'settings' => $settings,
        ]) ?? $data;
        if (!is_array($filtered)) {
            throw new CommerceException('Невалидна калкулация на доставката.', 500);
        }
        $data = $this->normalizeQuote($filtered, $methods, $methodId, $subtotal);
        $data['fingerprint'] = $this->fingerprint($data);

        return $data;
    }

    /**
     * @param array<int, int> $cart
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function place(array $cart, array $input, string $key): array
    {
        if ($existing = $this->db->table('flex_commerce_orders')->where('request_key', $key)->first()) return $this->decode($existing);
        if (!preg_match('/^[a-f0-9]{64}$/D', $key)) throw new CommerceException('Невалидна заявка.', 422);
        $selection = [
            'shipping' => is_string($input['shipping'] ?? null) ? $input['shipping'] : self::METHOD_ADDRESS,
            'shipping_meta' => is_array($input['shipping_meta'] ?? null) ? $input['shipping_meta'] : [],
        ];
        $preview = $this->quote($cart, $selection);
        $customer = $this->validate($input, $preview);
        $placed = $this->db->transaction(function () use ($cart, $input, $key, $customer, $selection): array {
            $this->db->table('flex_commerce_settings')->where('id', 1)->lockForUpdate()->first();
            if ($existing = $this->db->table('flex_commerce_orders')->where('request_key', $key)->first()) {
                return ['order' => $this->decode($existing), 'quote' => null, 'created' => false];
            }
            $ids = array_keys($cart); sort($ids, SORT_NUMERIC);
            $this->db->table('flex_commerce_products')->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
            $quote = $this->quote($cart, $selection);
            if (!is_string($input['fingerprint'] ?? null) || !hash_equals($quote['fingerprint'], $input['fingerprint'])) {
                throw new CommerceException('Цените или доставката са променени. Прегледайте обновената сума и потвърдете отново.', 409);
            }
            $now = gmdate('Y-m-d H:i:s');
            $number = 'FC-' . gmdate('Ymd') . '-' . strtoupper(bin2hex(random_bytes(6)));
            $id = $this->db->table('flex_commerce_orders')->insertGetId([
                'number' => $number,
                'request_key' => $key,
                'currency' => $quote['currency'],
                'subtotal_minor' => $quote['subtotal_minor'],
                'shipping_minor' => $quote['shipping_minor'],
                'total_minor' => $quote['total_minor'],
                'customer' => json_encode($customer, JSON_UNESCAPED_UNICODE),
                'items' => json_encode($quote['items']),
                'history' => json_encode([['status' => 'new', 'payment_status' => 'unpaid', 'at' => $now, 'actor' => null]]),
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            foreach ($quote['items'] as $item) {
                $this->db->table('flex_commerce_products')->where('id', $item['product_id'])->decrement('stock', $item['quantity'], ['updated_at' => $now, 'version' => $this->db->raw('version + 1')]);
            }

            return ['order' => $this->get($id), 'quote' => $quote, 'created' => true];
        });
        if ($placed['created'] && is_array($placed['quote'])) {
            $this->extensions?->doAction('commerce.order.placed', [
                'order' => $placed['order'],
                'input' => $input,
                'quote' => $placed['quote'],
            ]);
        }

        return $placed['order'];
    }

    /**
     * @param array<string, mixed> $context
     * @return list<array{id: string, label: string, type: string}>
     */
    public function shippingMethods(array $context = []): array
    {
        $settings = is_array($context['settings'] ?? null) ? $context['settings'] : (new CatalogStore($this->db))->settings();
        $mode = ($settings['shipping_mode'] ?? 'fixed') === 'econt' ? 'econt' : 'fixed';
        $fixed = [[
            'id' => self::METHOD_ADDRESS,
            'label' => 'Доставка до адрес',
            'type' => 'address',
        ]];
        // Fixed mode keeps only the built-in flat-rate method. Econt mode starts empty and lets the courier plugin register methods.
        $defaults = $mode === 'fixed' ? $fixed : [];
        $context = array_replace($context, ['settings' => $settings, 'shipping_mode' => $mode]);
        $filtered = $this->extensions?->applyFilters('commerce.shipping.methods', $defaults, $context) ?? $defaults;
        if (!is_array($filtered)) {
            return $fixed;
        }
        $methods = [];
        foreach ($filtered as $method) {
            if (!is_array($method)) continue;
            $id = is_string($method['id'] ?? null) ? trim($method['id']) : '';
            $label = is_string($method['label'] ?? null) ? trim($method['label']) : '';
            $type = is_string($method['type'] ?? null) ? trim($method['type']) : 'address';
            if ($id === '' || $label === '' || !in_array($type, ['address', 'office', 'custom'], true)) continue;
            if ($mode === 'fixed' && $id !== self::METHOD_ADDRESS) continue;
            if ($mode === 'econt' && $id === self::METHOD_ADDRESS) continue;
            if (isset($methods[$id])) continue;
            $methods[$id] = ['id' => $id, 'label' => $label, 'type' => $type];
        }

        if ($methods !== []) {
            return array_values($methods);
        }

        // Econt mode with no courier methods: keep checkout usable with the flat-rate fallback.
        return $fixed;
    }

    /**
     * @param array<string, mixed> $input
     * @param array<string, mixed> $quote
     * @return array<string, mixed>
     */
    private function validate(array $input, array $quote): array
    {
        $result = [];
        foreach (['first_name' => 80, 'last_name' => 80, 'email' => 190, 'phone' => 30, 'note' => 2000] as $field => $max) {
            $value = $input[$field] ?? '';
            if (!is_string($value) || mb_strlen(trim($value)) > $max || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value)) {
                throw new CommerceException('Попълнете коректно задължителните данни за клиента и доставката.', 422);
            }
            if ($field !== 'note' && trim($value) === '') {
                throw new CommerceException('Попълнете коректно задължителните данни за клиента и доставката.', 422);
            }
            $result[$field] = trim($value);
        }
        if (!filter_var($result['email'], FILTER_VALIDATE_EMAIL) || !preg_match('/^[+0-9 ()-]{6,30}$/D', $result['phone'])) {
            throw new CommerceException('Въведете валиден имейл и телефон.', 422);
        }
        if (($input['terms'] ?? false) !== true || ($input['payment'] ?? '') !== 'cod') {
            throw new CommerceException('Приемете условията и изберете наличния начин за доставка и плащане.', 422);
        }
        $methodId = is_string($quote['shipping'] ?? null) ? $quote['shipping'] : self::METHOD_ADDRESS;
        $methods = $quote['methods'] ?? [];
        $method = null;
        foreach (is_array($methods) ? $methods : [] as $entry) {
            if (is_array($entry) && ($entry['id'] ?? null) === $methodId) {
                $method = $entry;
                break;
            }
        }
        if ($method === null) {
            throw new CommerceException('Изберете наличния начин за доставка.', 422);
        }
        $type = $method['type'] ?? 'address';
        $meta = is_array($quote['shipping_meta'] ?? null) ? $quote['shipping_meta'] : [];
        foreach (['city' => 100, 'postcode' => 20, 'address' => 300] as $field => $max) {
            $value = $input[$field] ?? '';
            if (!is_string($value) || mb_strlen(trim($value)) > $max || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value)) {
                throw new CommerceException('Попълнете коректно задължителните данни за клиента и доставката.', 422);
            }
            $trimmed = trim($value);
            if ($type === 'address' && $trimmed === '') {
                throw new CommerceException('Попълнете коректно задължителните данни за клиента и доставката.', 422);
            }
            $result[$field] = $trimmed;
        }
        if ($type === 'office') {
            $office = $meta['office_code'] ?? ($input['shipping_meta']['office_code'] ?? '');
            if (!is_string($office) || trim($office) === '' || mb_strlen(trim($office)) > 40) {
                throw new CommerceException('Изберете офис за доставка.', 422);
            }
            $meta['office_code'] = trim($office);
            // Prefer office locator metadata when address fields were not shown in checkout.
            if ($result['city'] === '' && is_string($meta['city'] ?? null)) {
                $result['city'] = trim($meta['city']);
            }
            if ($result['postcode'] === '' && is_string($meta['postcode'] ?? null)) {
                $result['postcode'] = trim($meta['postcode']);
            }
            if ($result['address'] === '') {
                $officeAddress = $meta['office_address'] ?? ($meta['office_name'] ?? '');
                if (is_string($officeAddress)) {
                    $result['address'] = trim($officeAddress);
                }
            }
        }
        $result += [
            'shipping' => $methodId,
            'shipping_meta' => $meta,
            'payment' => 'cod',
            'terms_accepted_at' => gmdate('Y-m-d H:i:s'),
        ];
        $filtered = $this->extensions?->applyFilters('commerce.order.validate', $result, [
            'input' => $input,
            'method' => $method,
            'quote' => $quote,
        ]) ?? $result;
        if (!is_array($filtered)) {
            throw new CommerceException('Невалидни данни за доставка.', 422);
        }

        return $filtered;
    }

    /**
     * @param array<string, mixed> $data
     * @param list<array{id: string, label: string, type: string}> $methods
     * @return array<string, mixed>
     */
    private function normalizeQuote(array $data, array $methods, string $methodId, int $subtotal): array
    {
        $shippingMinor = isset($data['shipping_minor']) && is_numeric($data['shipping_minor']) ? max(0, (int) $data['shipping_minor']) : 0;
        $meta = is_array($data['shipping_meta'] ?? null) ? $data['shipping_meta'] : [];
        $resolvedMethod = is_string($data['shipping'] ?? null) && $data['shipping'] !== '' ? $data['shipping'] : $methodId;
        if (!in_array($resolvedMethod, array_column($methods, 'id'), true)) {
            $resolvedMethod = self::METHOD_ADDRESS;
        }

        return [
            'items' => $data['items'] ?? [],
            'currency' => is_string($data['currency'] ?? null) ? $data['currency'] : 'EUR',
            'subtotal_minor' => $subtotal,
            'shipping_minor' => $shippingMinor,
            'total_minor' => $subtotal + $shippingMinor,
            'payment' => 'cod',
            'shipping' => $resolvedMethod,
            'shipping_meta' => $meta,
            'methods' => $methods,
            'terms_url' => is_string($data['terms_url'] ?? null) ? $data['terms_url'] : '',
            'privacy_url' => is_string($data['privacy_url'] ?? null) ? $data['privacy_url'] : '',
        ];
    }

    /** @param array<string, mixed> $quote */
    private function fingerprint(array $quote): string
    {
        $payload = [
            'items' => $quote['items'],
            'currency' => $quote['currency'],
            'subtotal_minor' => $quote['subtotal_minor'],
            'shipping_minor' => $quote['shipping_minor'],
            'total_minor' => $quote['total_minor'],
            'payment' => $quote['payment'],
            'shipping' => $quote['shipping'],
            'shipping_meta' => $quote['shipping_meta'] ?? [],
        ];

        return hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE));
    }

    public function get(int $id): array
    {
        $row = $this->db->table('flex_commerce_orders')->where('id', $id)->first();
        if (!$row) throw new CommerceException('Поръчката не е намерена.', 404);
        return $this->decode($row);
    }

    private function decode(object $row): array
    {
        $result = (array) $row; unset($result['request_key']);
        foreach (['customer', 'items', 'history'] as $field) $result[$field] = json_decode($result[$field], true);
        foreach (['id', 'version', 'subtotal_minor', 'shipping_minor', 'total_minor'] as $field) $result[$field] = (int) $result[$field];
        return $result;
    }

    public function listing(array $filters): array
    {
        $query = $this->db->table('flex_commerce_orders'); $status = $filters['status'] ?? 'all';
        if (!is_string($status) || !in_array($status, ['all', ...self::STATUSES], true)) throw new CommerceException('Невалиден статус.', 422);
        if ($status !== 'all') $query->where('status', $status);
        $search = $filters['q'] ?? '';
        if (!is_string($search) || mb_strlen($search) > 190) throw new CommerceException('Невалидно търсене.', 422);
        if ($search !== '') $query->where(static fn ($q) => $q->where('number', 'like', '%' . $search . '%')->orWhere('customer', 'like', '%' . $search . '%'));
        $count = $query->count(); $pages = max(1, (int) ceil($count / 25)); $page = min($pages, max(1, (int) ($filters['page'] ?? 1)));
        return ['records' => $query->orderByDesc('id')->offset(($page - 1) * 25)->limit(25)->get()->map(fn ($r) => $this->decode($r))->all(), 'count' => $count, 'page' => $page, 'pages' => $pages];
    }

    public function update(int $id, array $input, ?int $actor): array
    {
        return $this->db->transaction(function () use ($id, $input, $actor): array {
            $order = $this->db->table('flex_commerce_orders')->where('id', $id)->lockForUpdate()->first();
            if (!$order) throw new CommerceException('Поръчката не е намерена.', 404);
            if ((int) ($input['version'] ?? 0) !== (int) $order->version) throw new CommerceException('Поръчката е променена. Презаредете я.', 409);
            $status = $input['status'] ?? $order->status; $payment = $input['payment_status'] ?? $order->payment_status;
            $transitions = ['new' => ['new', 'processing', 'cancelled'], 'processing' => ['processing', 'shipped', 'completed', 'cancelled'], 'shipped' => ['shipped', 'completed', 'cancelled'], 'completed' => ['completed', 'cancelled'], 'cancelled' => ['cancelled']];
            if (!is_string($status) || !in_array($status, $transitions[$order->status], true) || !in_array($payment, ['unpaid', 'paid', 'refunded'], true)) throw new CommerceException('Невалиден преход на статуса.', 422);
            if ($status === $order->status && $payment === $order->payment_status) return $this->decode($order);
            $now = gmdate('Y-m-d H:i:s'); $items = json_decode($order->items, true); $restored = (bool) $order->stock_restored;
            if ($status === 'cancelled' && !$restored) {
                usort($items, static fn ($a, $b) => $a['product_id'] <=> $b['product_id']);
                foreach ($items as $item) $this->db->table('flex_commerce_products')->where('id', $item['product_id'])->increment('stock', $item['quantity'], ['updated_at' => $now, 'version' => $this->db->raw('version + 1')]);
                $restored = true;
            }
            foreach ($items as $item) {
                $sale = $this->db->table('flex_commerce_sales')->where('reference', $order->number)->where('product_id', $item['product_id']);
                if ($status === 'completed') $this->db->table('flex_commerce_sales')->updateOrInsert(['reference' => $order->number, 'product_id' => $item['product_id']], ['quantity' => $item['quantity'], 'cancelled' => false, 'created_at' => $now]);
                if ($status === 'cancelled') $sale->update(['cancelled' => true]);
            }
            $history = json_decode($order->history, true); $history[] = ['status' => $status, 'payment_status' => $payment, 'at' => $now, 'actor' => $actor];
            $this->db->table('flex_commerce_orders')->where('id', $id)->update(['status' => $status, 'payment_status' => $payment, 'stock_restored' => $restored, 'history' => json_encode($history), 'version' => $order->version + 1, 'updated_at' => $now]);
            $updated = $this->get($id);
            $this->extensions?->doAction('commerce.order.updated', ['order' => $updated, 'previous_status' => $order->status, 'previous_payment_status' => $order->payment_status]);

            return $updated;
        });
    }
}
