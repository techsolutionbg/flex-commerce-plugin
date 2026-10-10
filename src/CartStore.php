<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Illuminate\Database\Connection;
use Illuminate\Database\Eloquent\Model;

final class CartStore
{
    private Connection $db;
    public function __construct(?Connection $db = null)
    {
        $this->db = $db ?? Model::resolveConnection();
    }
    public function stock(int $id): int
    {
        return max(0, (int) $this->db->table('flex_commerce_products')->where('id', $id)->where('status', 'active')->whereNull('deleted_at')->value('stock'));
    }
    public function quantities(array $cart): array
    {
        $result = [];
        $rows = $this->db->table('flex_commerce_products')->whereIn('id', array_keys($cart))->where('status', 'active')->whereNull('deleted_at')->get(['id', 'stock']);
        foreach ($rows as $row) {
            $quantity = min(max(0, (int) ($cart[$row->id] ?? 0)), max(0, (int) $row->stock));
            if ($quantity > 0) {
                $result[(int) $row->id] = $quantity;
            }
        }
        return $result;
    }
    public function add(array $cart, mixed $id, mixed $quantity): array
    {
        if ((!is_int($id) && !is_string($id)) || (!is_int($quantity) && !is_string($quantity))) {
            throw new CommerceException('Въведете цяло положително количество.', 422);
        }
        $id = filter_var($id, FILTER_VALIDATE_INT);
        $quantity = filter_var($quantity, FILTER_VALIDATE_INT);
        if (!is_int($id) || $id < 1 || !is_int($quantity) || $quantity < 1 || $quantity > 1000000) {
            throw new CommerceException('Въведете цяло положително количество.', 422);
        }
        $row = $this->db->table('flex_commerce_products')->where('id', $id)->where('status', 'active')->whereNull('deleted_at')->first(['stock']);
        if (!$row) {
            throw new CommerceException('Продуктът вече не е достъпен.', 404);
        }
        $cart = $this->quantities($cart);
        $remaining = max(0, (int) $row->stock - ($cart[$id] ?? 0));
        if ($quantity > $remaining) {
            throw new CommerceException($remaining > 0 ? 'Можете да добавите още най-много ' . $remaining . ' бр. от този продукт.' : 'Няма повече налични бройки за добавяне.', 409);
        }
        if (!isset($cart[$id]) && count($cart) >= 100) {
            throw new CommerceException('Количката може да съдържа до 100 различни продукта.', 422);
        }
        $cart[$id] = ($cart[$id] ?? 0) + $quantity;
        return $cart;
    }
    public function setQuantity(array $cart, mixed $id, mixed $quantity): array
    {
        if ((!is_int($id) && !is_string($id)) || (!is_int($quantity) && !is_string($quantity))) {
            throw new CommerceException('Въведете цяло положително количество.', 422);
        }
        $id = filter_var($id, FILTER_VALIDATE_INT);
        $quantity = filter_var($quantity, FILTER_VALIDATE_INT);
        if (!is_int($id) || $id < 1 || !is_int($quantity) || $quantity < 1 || $quantity > 1000000) {
            throw new CommerceException('Въведете цяло положително количество.', 422);
        }
        if (!isset($cart[$id])) {
            throw new CommerceException('Продуктът не е в количката.', 404);
        }
        $stock = $this->stock($id);
        if ($quantity > $stock) {
            throw new CommerceException('Налични са най-много ' . $stock . ' бр. от този продукт.', 409);
        }
        $cart = $this->quantities($cart);
        $cart[$id] = $quantity;
        return $cart;
    }
    public function summary(array $cart): array
    {
        $cart = $this->quantities($cart);
        $rows = $this->db->table('flex_commerce_products')->whereIn('id', array_keys($cart))->get(['id','name','slug','price_minor','sale_price_minor','currency','stock','images']);
        $mediaIds = [];
        foreach ($rows as $row) {
            $mediaIds = array_merge($mediaIds, json_decode($row->images, true) ?? []);
        }
        $media = $mediaIds ? $this->db->table('media')->whereIn('id', array_unique($mediaIds))->whereNull('deleted_at')->where('mime', 'like', 'image/%')->get()->keyBy('id') : collect();
        $items = [];
        $totals = [];
        foreach ($rows as $row) {
            $image = null;
            foreach (json_decode($row->images, true) ?? [] as $mediaId) {
                if ($m = $media->get($mediaId)) {
                    $image = '/media-files/' . (int) $mediaId . (empty($m->thumbnail_path) ? '/original' : '/thumbnail');
                    break;
                }
            }
            $minor = isset($row->sale_price_minor) && (int) $row->sale_price_minor < (int) $row->price_minor ? (int) $row->sale_price_minor : (int) $row->price_minor;
            $line = $minor * $cart[$row->id];
            $totals[$row->currency] = ($totals[$row->currency] ?? 0) + $line;
            $items[] = ['id' => (int) $row->id, 'name' => $row->name, 'url' => '/product/' . rawurlencode($row->slug), 'image' => $image, 'quantity' => $cart[$row->id], 'stock' => max(0, (int) $row->stock), 'remaining' => max(0, (int) $row->stock - $cart[$row->id]), 'price' => number_format($minor / 100, 2, ',', ' '), 'line_total' => number_format($line / 100, 2, ',', ' '), 'currency' => $row->currency];
        }
        ksort($totals);
        return ['items' => $items, 'count' => array_sum($cart), 'totals' => array_map(static fn($currency, $minor) => ['currency' => $currency, 'amount_minor' => $minor, 'amount' => number_format($minor / 100, 2, ',', ' ')], array_keys($totals), array_values($totals))];
    }
}
