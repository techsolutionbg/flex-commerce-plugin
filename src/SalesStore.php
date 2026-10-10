<?php

declare(strict_types=1);
namespace Flex\Commerce;
use Illuminate\Database\Connection;
use Illuminate\Database\Eloquent\Model;
final class SalesStore
{
    private Connection $db;
    public function __construct(?Connection $db = null) { $this->db = $db ?? Model::resolveConnection(); }
    // Call once per completed order line. This is accounting, not an inventory mutation.
    public function record(array $input): void
    {
        foreach (['product_id', 'quantity'] as $field) {
            if (!is_int($input[$field] ?? null) && !is_string($input[$field] ?? null)) throw new CommerceException('Невалидно количество или продукт.', 422);
        }
        $id = filter_var($input['product_id'] ?? null, FILTER_VALIDATE_INT);
        $quantity = filter_var($input['quantity'] ?? null, FILTER_VALIDATE_INT);
        $reference = $input['reference'] ?? null;
        if (!is_int($id) || $id < 1 || !is_int($quantity) || $quantity < 1 || $quantity > 1000000 || !is_string($reference) || trim($reference) === '' || mb_strlen($reference) > 100 || preg_match('/[\x00-\x1f]/', $reference)) {
            throw new CommerceException('Изберете продукт, положително количество и номер на поръчка (до 100 символа).', 422);
        }
        if (str_starts_with(trim($reference), 'FC-')) throw new CommerceException('Продажбите от поръчки се управляват от раздел Поръчки.', 422);
        if (!$this->db->table('flex_commerce_products')->where('id', $id)->whereNull('deleted_at')->exists()) throw new CommerceException('Продуктът не е намерен.', 404);
        try {
            $this->db->table('flex_commerce_sales')->insert(['product_id' => $id, 'quantity' => $quantity, 'reference' => trim($reference), 'created_at' => gmdate('Y-m-d H:i:s')]);
        } catch (\Illuminate\Database\UniqueConstraintViolationException) {
            throw new CommerceException('Този продукт вече е отчетен за тази поръчка.', 409);
        }
    }
    public function cancel(int $id, mixed $cancelled): void
    {
        if (!is_bool($cancelled)) throw new CommerceException('Невалиден статус.', 422);
        if (!$this->db->table('flex_commerce_sales')->where('id', $id)->exists()) throw new CommerceException('Продажбата не е намерена.', 404);
        if (str_starts_with((string)$this->db->table('flex_commerce_sales')->where('id',$id)->value('reference'), 'FC-')) throw new CommerceException('Променете статуса в раздел Поръчки.',422);
        $this->db->table('flex_commerce_sales')->where('id', $id)->update(['cancelled' => $cancelled]);
    }
    public function report(): array
    {
        $totals = $this->db->table('flex_commerce_sales')->where('cancelled', false)->select('product_id')->selectRaw('SUM(quantity) AS sold')->groupBy('product_id');
        $ranking = $this->db->table('flex_commerce_products as p')->joinSub($totals, 'sales', 'sales.product_id', '=', 'p.id')->whereNull('p.deleted_at')->select(['p.id', 'p.name', 'p.status', 'sales.sold'])->orderByDesc('sales.sold')->orderBy('p.id')->get()->map(static fn($r) => ['id' => (int) $r->id, 'name' => $r->name, 'status' => $r->status, 'sold' => (int) $r->sold])->all();
        $records = $this->db->table('flex_commerce_sales as s')->leftJoin('flex_commerce_products as p', 'p.id', '=', 's.product_id')->select(['s.*', 'p.name'])->orderByDesc('s.id')->limit(100)->get()->map(static fn($r) => ['id' => (int) $r->id, 'name' => $r->name ?? 'Изтрит продукт', 'reference' => $r->reference, 'quantity' => (int) $r->quantity, 'cancelled' => (bool) $r->cancelled, 'created_at' => $r->created_at])->all();
        return ['ranking' => $ranking, 'sales' => $records];
    }
}
