<?php

declare(strict_types=1);

namespace Flex\Commerce\Tests;

use Flex\Commerce\{CatalogStore, CommerceException};
use Flex\Configuration\ConfigurationRepository;
use Flex\Database\DatabaseManager;
use Illuminate\Database\Schema\Blueprint;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/CommerceException.php';
require_once __DIR__ . '/../src/CatalogStore.php';
require_once __DIR__ . '/../src/CatalogController.php';
final class CatalogTest extends TestCase
{
    private DatabaseManager $db;
    private CatalogStore $store;
    protected function setUp(): void
    {
        $this->db = new DatabaseManager(new ConfigurationRepository(['database' => ['default' => 'sqlite','connections' => ['sqlite' => ['driver' => 'sqlite','database' => ':memory:','prefix' => '']]]]));
        $this->db->schema()->create('media', static function (Blueprint $t): void {
            $t->increments('id');
            $t->string('title');
            $t->string('mime');
            $t->softDeletes();
        });
        $this->db->connection()->table('media')->insert([['id' => 1,'title' => 'Фото','mime' => 'image/png'],['id' => 2,'title' => 'PDF','mime' => 'application/pdf']]);
        $this->store = new CatalogStore($this->db->connection());
        $this->store->install();
        $this->store->install();
    }
    protected function tearDown(): void
    {
        $this->db->disconnect();
    }
    private function product(): array
    {
        return ['name' => 'Тестов продукт','price' => '19.99','stock' => 5,'images' => [1],'sku' => 'TEST'];
    }
    public function testSettingsRejectUnsafeLinks(): void
    {
        foreach (['/\\evil.example', '/terms%0aheader', 'https://', 'https://example.test/a b', '//evil.example'] as $url) {
            foreach (['terms_url', 'privacy_url', 'shipping_terms_url'] as $field) {
                try {
                    $this->store->saveSettings(array_replace($this->store->settings(), [$field => $url]));
                    self::fail('Unsafe URL accepted');
                } catch (CommerceException $error) {
                    self::assertSame(422, $error->getCode());
                }
            }
        }
        foreach (['/terms', 'https://example.test/terms'] as $url) {
            self::assertSame($url, $this->store->saveSettings(array_replace($this->store->settings(), ['terms_url' => $url]))['terms_url']);
        }
    }
    public function testExactMoneyAndInvalidPrices(): void
    {
        self::assertSame(1999, CatalogStore::price('19.99'));
        self::assertSame(105, CatalogStore::price('1,05'));
        self::assertSame(10, CatalogStore::price('0.1'));
        self::assertSame(0, CatalogStore::price('0'));
        foreach (['-1','1.001','1e2','NaN','10000000','1.2x',1.2] as $v) {
            try {
                CatalogStore::price($v);
                self::fail('Invalid amount');
            } catch (CommerceException $e) {
                self::assertSame(422, $e->getCode());
            }
        }
    }
    public function testCrudAndConflicts(): void
    {
        $p = $this->store->save('products', $this->product());
        self::assertSame(1999, $p['price_minor']);
        self::assertSame('19.99', $p['price']);
        self::assertSame([1], $p['images']);
        self::assertSame('TEST', $p['sku']);
        $p['price'] = '20.01';
        $updated = $this->store->save('products', $p, $p['id']);
        self::assertSame(2001, $updated['price_minor']);
        self::assertSame(2, $updated['version']);
        try {
            $this->store->save('products', $p, $p['id']);
            self::fail('Stale accepted');
        } catch (CommerceException $e) {
            self::assertSame(409, $e->getCode());
        }
        try {
            $this->store->save('products', $this->product());
            self::fail('Duplicate SKU');
        } catch (CommerceException $e) {
            self::assertSame(409, $e->getCode());
        }
        $this->store->action('products', $p['id'], 'trash', 2);
        self::assertCount(0, $this->store->index('products'));
        self::assertCount(1, $this->store->index('products', 'trash'));
        $this->store->action('products', $p['id'], 'restore', 3);
        self::assertCount(1, $this->store->index('products'));
        try {
            $this->store->action('products', $p['id'], 'force', 4);
            self::fail('Active deleted');
        } catch (CommerceException $e) {
            self::assertSame(409, $e->getCode());
        }
        $this->store->action('products', $p['id'], 'trash', 4);
        $this->store->action('products', $p['id'], 'force', 5);
        self::assertCount(0, $this->store->index('products', 'trash'));
        self::assertSame(2, $this->db->connection()->table('media')->count());
    }
    public function testCategoriesAndMediaValidation(): void
    {
        $c = $this->store->save('categories', ['name' => 'Облекло']);
        $input = $this->product();
        $input['category_ids'] = [$c['id']];
        $p = $this->store->save('products', $input);
        self::assertSame([$c['id']], $p['category_ids']);
        $this->store->action('categories', $c['id'], 'trash', 1);
        $this->store->save('products', $p, $p['id']);
        try {
            $this->store->action('categories', $c['id'], 'force', 2);
            self::fail('Linked deleted');
        } catch (CommerceException $e) {
            self::assertSame(409, $e->getCode());
        }
        foreach ([['images' => [2]],['images' => [999]],['stock' => -1],['stock' => '1.1'],['category_ids' => [999]],['status' => 'bad'],['currency' => 'bad']] as $bad) {
            try {
                $this->store->save('products', array_replace($this->product(), $bad, ['sku' => 'OTHER']));
                self::fail('Invalid input');
            } catch (CommerceException $e) {
                self::assertSame(422, $e->getCode());
            }
        }
    }
    public function testApiAndGeneratedSlugs(): void
    {
        $controller = new \Flex\Commerce\CatalogController(new \Flex\Http\ResponseFactory(new \Nyholm\Psr7\Factory\Psr17Factory()), new \Flex\Http\RequestInput());
        $r = $controller((new \Nyholm\Psr7\ServerRequest('POST', '/admin/plugins/flex/commerce/products'))->withParsedBody($this->product()));
        self::assertSame(201, $r->getStatusCode());
        $p = json_decode((string) $r->getBody(), true)['record'];
        self::assertSame('testov-produkt', $p['slug']);
        $second = $this->store->save('products', array_replace($this->product(), ['sku' => '']));
        self::assertSame('testov-produkt-2',$second['slug']);
        $r = $controller(new \Nyholm\Psr7\ServerRequest('GET','/admin/plugins/flex/commerce/products'));
        self::assertCount(2,json_decode((string) $r->getBody(),true)['records']);
    }
    public function testImageDetailsAreSpecificToEachProductAndPreserveEmptyOverrides(): void
    {
        $first = $this->store->save('products', $this->product());
        self::assertSame('Фото', $first['image_details'][1]['title']);
        $first['image_details'][1]['title'] = '';
        $first['image_details'][1]['alt'] = 'Само за този продукт';
        $first['image_details'][1]['link'] = '/shop/product';
        $updated = $this->store->save('products', $first, $first['id']);
        self::assertSame('', $updated['image_details'][1]['title']);
        self::assertSame('Само за този продукт', $updated['image_details'][1]['alt']);
        $other = $this->product();
        $other['sku'] = 'SECOND';
        $second = $this->store->save('products', $other);
        self::assertSame('Фото', $second['image_details'][1]['title']);
        self::assertSame('', $second['image_details'][1]['alt']);
        self::assertSame('Фото', $this->db->connection()->table('media')->where('id', 1)->value('title'));
        $updated['image_details'][1]['link'] = 'javascript:alert(1)';
        $this->expectException(CommerceException::class);
        $this->store->save('products', $updated, $updated['id']);
    }
    public function testSettingsDefaultsApplyToNewProductsAndRejectStaleUpdates(): void
    {
        $before = $this->store->save('products', $this->product());
        $settings = $this->store->settings();
        $saved = $this->store->saveSettings(array_replace($settings, ['currency' => 'USD', 'default_stock' => 8, 'default_status' => 'inactive']));
        self::assertSame(2, $saved['version']);
        $new = $this->store->save('products', ['name' => 'Нов продукт', 'price' => '2.00']);
        self::assertSame('USD', $new['currency']);
        self::assertSame(8, $new['stock']);
        self::assertSame('inactive', $new['status']);
        self::assertSame('EUR', $this->store->get('products', $before['id'])['currency']);
        $this->expectException(CommerceException::class);
        $this->store->saveSettings($settings);
    }
    public function testProductPageLayoutPersistsAndRejectsUnknownValues(): void
    {
        $settings = $this->store->settings();
        self::assertSame('plain', $settings['product_page_layout']);
        $saved = $this->store->saveSettings(array_replace($settings, ['product_page_layout' => 'boxed']));
        self::assertSame('boxed', $this->store->settings()['product_page_layout']);
        unset($saved['product_page_layout']);
        $saved = $this->store->saveSettings($saved);
        self::assertSame('boxed', $saved['product_page_layout']);
        try {
            $this->store->saveSettings(array_replace($saved, ['product_page_layout' => 'invalid']));
            self::fail('Unknown layouts must be rejected.');
        } catch (CommerceException $error) {
            self::assertSame(422, $error->getCode());
        }
        self::assertSame($saved, $this->store->settings());
    }
    public function testProductTemplateAppliesOnlyTheSelectedLayout(): void
    {
        $twig = new \Twig\Environment(new \Twig\Loader\FilesystemLoader(__DIR__ . '/../templates'), ['strict_variables' => true, 'autoescape' => 'html']);
        $product = ['name' => 'Тестов продукт', 'price' => '10,00', 'currency' => 'EUR', 'excerpt' => '', 'available' => true, 'sku' => '', 'categories' => [], 'images' => [], 'description' => ''];
        $plain = $twig->render('product.twig', ['product' => $product]);
        self::assertStringNotContainsString('commerce-product-layout--boxed', $plain);
        $boxed = $twig->render('product.twig', ['product' => $product, 'product_page_layout' => 'boxed']);
        self::assertStringContainsString('commerce-product-layout--boxed', $boxed);
        self::assertStringContainsString('Тестов продукт', $boxed);
        $document = new \DOMDocument();
        @$document->loadHTML('<?xml encoding="UTF-8">' . $boxed);
        $xpath = new \DOMXPath($document);
        self::assertSame(1, $xpath->query('//div[contains(@class, "commerce-product-layout--boxed")]//section[@data-commerce-product-tabs]')->length);
        self::assertSame(2, $xpath->query('//div[contains(@class, "commerce-product-layout--boxed")]//section[@data-commerce-panel]')->length);
    }
}
