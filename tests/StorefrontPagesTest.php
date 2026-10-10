<?php

declare(strict_types=1);

namespace Flex\Commerce\Tests;

use Flex\Commerce\CatalogStore;
use Flex\Commerce\StorefrontPages;
use Flex\Configuration\ConfigurationRepository;
use Flex\Database\DatabaseManager;
use Flex\Pages\Page;
use Illuminate\Database\Schema\Blueprint;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/CommerceException.php';
require_once __DIR__ . '/../src/CatalogStore.php';
require_once __DIR__ . '/../src/StorefrontPages.php';

final class StorefrontPagesTest extends TestCase
{
    private DatabaseManager $db;

    protected function setUp(): void
    {
        $this->db = new DatabaseManager(new ConfigurationRepository(['database' => ['default' => 'sqlite', 'connections' => ['sqlite' => ['driver' => 'sqlite', 'database' => ':memory:', 'prefix' => '']]]]));
        $this->db->schema()->create('pages', static function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedBigInteger('author_id')->nullable();
            $table->unsignedInteger('parent_id')->nullable();
            $table->string('title', 190);
            $table->string('slug', 190)->unique();
            $table->text('content')->nullable();
            $table->string('status', 20)->default('draft');
            $table->timestamp('published_at')->nullable();
            $table->json('settings')->nullable();
            $table->text('blocks')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
        (new CatalogStore($this->db->connection()))->install();
    }

    protected function tearDown(): void
    {
        $this->db->disconnect();
    }

    public function testCreatesShippingDraftAndLinksOnlyAfterPublication(): void
    {
        (new StorefrontPages())->ensure();
        $page = Page::query()->where('slug', StorefrontPages::SHIPPING_SLUG)->first();
        self::assertNotNull($page);
        self::assertSame('draft', $page->status);
        self::assertNull($page->published_at);
        self::assertSame('Доставка с Еконт', $page->title);
        self::assertStringContainsString('Еконт', (string) $page->content);
        self::assertStringContainsString('наложен платеж', mb_strtolower((string) $page->content));
        self::assertSame('', (new CatalogStore($this->db->connection()))->settings()['shipping_terms_url']);
        $page->status = 'published';
        $page->published_at = gmdate('Y-m-d H:i:s');
        $page->save();

        (new StorefrontPages())->ensure();
        self::assertSame(1, Page::query()->where('slug', StorefrontPages::SHIPPING_SLUG)->count());
        self::assertSame('/' . StorefrontPages::SHIPPING_SLUG, (new CatalogStore($this->db->connection()))->settings()['shipping_terms_url']);
    }

    public function testDoesNotOverwriteExistingShippingTermsUrl(): void
    {
        $store = new CatalogStore($this->db->connection());
        $settings = $store->settings();
        $store->saveSettings(array_replace($settings, ['shipping_terms_url' => '/custom-shipping']));
        (new StorefrontPages())->ensure();
        self::assertSame('/custom-shipping', $store->settings()['shipping_terms_url']);
        self::assertNotNull(Page::query()->where('slug', StorefrontPages::SHIPPING_SLUG)->first());
    }
}
