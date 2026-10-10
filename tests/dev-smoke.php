<?php

declare(strict_types=1);
require dirname(__DIR__, 4) . '/vendor/autoload.php';
\Flex\Bootstrap::boot(dirname(__DIR__, 4));
require_once __DIR__ . '/../src/CommerceException.php';
require_once __DIR__ . '/../src/CatalogStore.php';
$store = new \Flex\Commerce\CatalogStore();
$product = null;
$category = null;
try {
    $category = $store->save('categories', ['name' => 'Commerce smoke ' . bin2hex(random_bytes(5))]);
    $product = $store->save('products', ['name' => 'Commerce smoke ' . bin2hex(random_bytes(5)), 'price' => '25.09', 'stock' => 3, 'category_ids' => [$category['id']]]);
    if ($product['price_minor'] !== 2509 || $product['category_ids'] !== [$category['id']]) {
        throw new RuntimeException('Create mismatch');
    }
    $product['price'] = '30.01';
    $product = $store->save('products', $product, $product['id']);
    if ($product['price_minor'] !== 3001 || $product['version'] !== 2) {
        throw new RuntimeException('Update mismatch');
    }
    echo "Dev database create/read/update smoke passed.\n";
} finally {
    if ($product) {
        $row = $store->get('products', $product['id']);
        $store->action('products', $row['id'], 'trash', $row['version']);
        $store->action('products', $row['id'], 'force', $row['version'] + 1);
    }
    if ($category) {
        $row = $store->get('categories', $category['id']);
        $store->action('categories', $row['id'], 'trash', $row['version']);
        $store->action('categories', $row['id'], 'force', $row['version'] + 1);
    }
}
echo "Temporary records removed.\n";
