<?php
declare(strict_types=1);
namespace Flex\Commerce\Tests;
use Flex\Configuration\ConfigurationRepository;
use Flex\Database\DatabaseManager;
use Flex\Commerce\{CatalogStore, OrderStore, CommerceException};
use PHPUnit\Framework\TestCase;
foreach (['CommerceException','CatalogStore','OrderStore'] as $class) require_once __DIR__.'/../src/'.$class.'.php';
final class OrderStoreTest extends TestCase
{
    private DatabaseManager $manager;
    private OrderStore $store;
    private bool $mysql = false;
    protected function setUp(): void
    {
        $connection = ['driver'=>'sqlite','database'=>':memory:','prefix'=>''];
        $this->mysql = getenv('FLEX_COMMERCE_TEST_MYSQL') === '1';
        if ($this->mysql) {
            (new \Flex\Configuration\EnvironmentLoader())->load(dirname(__DIR__, 4));
            $platform = (new \Flex\Configuration\ConfigurationLoader())->load(dirname(__DIR__, 4), false);
            $connection = $platform->array('database.connections.mysql');
            $connection['prefix'] = 'ct' . bin2hex(random_bytes(3)) . '_';
        }
        $this->manager=new DatabaseManager(new ConfigurationRepository(['database'=>['default'=>'test','connections'=>['test'=>$connection]]]));
        $db=$this->manager->connection(); (new CatalogStore($db))->install(); $this->store=new OrderStore($db);$this->store->install();
        $db->table('flex_commerce_products')->insert(['id'=>1,'name'=>'Подарък','slug'=>'gift','description'=>'','status'=>'active','price_minor'=>1000,'sale_price_minor'=>800,'stock'=>5,'images'=>'[]','category_ids'=>'[]','sku'=>'GIFT']);
    }
    protected function tearDown(): void {
        if ($this->mysql) {
            foreach (['orders', 'sales', 'products', 'categories', 'settings'] as $table) {
                $this->manager->connection()->getSchemaBuilder()->dropIfExists('flex_commerce_' . $table);
            }
        }
        $this->manager->disconnect();
    }
    public function testDisabledCheckoutAndInvalidQuantitiesDoNotCreateOrders(): void
    {
        foreach ([0, -1, '2', 1000001] as $quantity) {
            try { $this->store->quote([1 => $quantity]); self::fail('Invalid quantity accepted'); }
            catch (CommerceException $error) { self::assertSame(422, $error->getCode()); }
        }
        $catalog = new CatalogStore($this->manager->connection());
        $catalog->saveSettings(array_replace($catalog->settings(), ['checkout_enabled' => false]));
        try { $this->store->quote([1 => 1]); self::fail('Disabled checkout accepted'); }
        catch (CommerceException $error) { self::assertSame(503, $error->getCode()); }
        self::assertSame(0, $this->manager->connection()->table('flex_commerce_orders')->count());
        self::assertSame(5, (int) $this->manager->connection()->table('flex_commerce_products')->value('stock'));
    }
    public function testShippingPriceChangeRejectsTheOldQuote(): void
    {
        $input = $this->input();
        $catalog = new CatalogStore($this->manager->connection());
        $catalog->saveSettings(array_replace($catalog->settings(), ['shipping_minor' => 900]));
        try { $this->store->place([1 => 2], $input, str_repeat('9', 64)); self::fail('Old shipping quote accepted'); }
        catch (CommerceException $error) { self::assertSame(409, $error->getCode()); }
        self::assertSame(0, $this->manager->connection()->table('flex_commerce_orders')->count());
        self::assertSame(5, (int) $this->manager->connection()->table('flex_commerce_products')->value('stock'));
    }
    private function input(array $cart=[1=>2]): array
    {
        return ['first_name'=>'Иван','last_name'=>'Иванов','email'=>'test@example.invalid','phone'=>'+359888123456','city'=>'София','postcode'=>'1000','address'=>'Улица 1','note'=>'','terms'=>true,'payment'=>'cod','shipping'=>'address','fingerprint'=>$this->store->quote($cart)['fingerprint']];
    }
    public function testSnapshotAndDuplicateSubmission(): void
    {
        $key=str_repeat('a',64);$input=$this->input();$order=$this->store->place([1=>2],$input,$key);
        self::assertSame(1,$this->store->listing(['q'=>'Иван'])['count']);
        self::assertSame(1600,$order['subtotal_minor']); self::assertSame(2100,$order['total_minor']);
        self::assertSame(3,$this->manager->connection()->table('flex_commerce_products')->value('stock'));
        $duplicate=$this->store->place([],$input,$key);self::assertSame($order['id'],$duplicate['id']);
        self::assertSame(1,$this->manager->connection()->table('flex_commerce_orders')->count());
        $this->manager->connection()->table('flex_commerce_products')->update(['price_minor'=>2000,'sale_price_minor'=>null]);
        self::assertSame(800,$this->store->get($order['id'])['items'][0]['price_minor']);
    }
    public function testChangedPriceAndStockRollback(): void
    {
        $input=$this->input();$this->manager->connection()->table('flex_commerce_products')->update(['sale_price_minor'=>700]);
        try{$this->store->place([1=>2],$input,str_repeat('b',64));self::fail('Stale price accepted');}catch(CommerceException $e){self::assertSame(409,$e->getCode());}
        self::assertSame(0,$this->manager->connection()->table('flex_commerce_orders')->count());
        self::assertSame(5,$this->manager->connection()->table('flex_commerce_products')->value('stock'));
        $input=$this->input();$this->manager->connection()->table('flex_commerce_products')->update(['stock'=>1]);
        try{$this->store->place([1=>2],$input,str_repeat('c',64));self::fail('Oversold');}catch(CommerceException $e){self::assertSame(409,$e->getCode());}
    }
    public function testCompletionCountsSalesAndCancellationRestoresOnce(): void
    {
        $order=$this->store->place([1=>2],$this->input(),str_repeat('d',64));
        self::assertSame(0,$this->manager->connection()->table('flex_commerce_sales')->count());
        $order=$this->store->update($order['id'],['version'=>$order['version'],'status'=>'processing'],7);
        $order=$this->store->update($order['id'],['version'=>$order['version'],'status'=>'completed','payment_status'=>'paid'],7);
        self::assertSame(2,(int)$this->manager->connection()->table('flex_commerce_sales')->where('cancelled',false)->sum('quantity'));
        $order=$this->store->update($order['id'],['version'=>$order['version'],'status'=>'completed'],7);
        self::assertSame(1,$this->manager->connection()->table('flex_commerce_sales')->count());
        $order=$this->store->update($order['id'],['version'=>$order['version'],'status'=>'cancelled','payment_status'=>'refunded'],7);
        self::assertSame(5,$this->manager->connection()->table('flex_commerce_products')->value('stock'));
        self::assertSame(0,(int)$this->manager->connection()->table('flex_commerce_sales')->where('cancelled',false)->sum('quantity'));
        $this->store->update($order['id'],['version'=>$order['version'],'status'=>'cancelled'],7);
        self::assertSame(5,$this->manager->connection()->table('flex_commerce_products')->value('stock'));
        self::assertSame(7,$order['history'][1]['actor']);
        try{$this->store->update($order['id'],['version'=>$order['version'],'status'=>'processing'],7);self::fail('Cancelled order reopened');}catch(CommerceException $e){self::assertSame(422,$e->getCode());}
    }
    public function testValidationCurrencySettingsAndVersion(): void
    {
        $input=$this->input();$input['terms']=false;
        try{$this->store->place([1=>2],$input,str_repeat('e',64));self::fail('Missing agreement accepted');}catch(CommerceException $e){self::assertSame(422,$e->getCode());}
        $catalog=new CatalogStore($this->manager->connection());$settings=$catalog->settings();
        $settings=$catalog->saveSettings(array_replace($settings,['shipping_minor'=>700,'free_shipping_minor'=>1500]));
        self::assertSame(0,$this->store->quote([1=>2])['shipping_minor']);self::assertSame(700,$this->store->quote([1=>1])['shipping_minor']);
        $order=$this->store->place([1=>2],$this->input(),str_repeat('f',64));
        try{$this->store->update($order['id'],['version'=>0,'status'=>'processing'],7);self::fail('Stale version accepted');}catch(CommerceException $e){self::assertSame(409,$e->getCode());}
        $this->manager->connection()->table('flex_commerce_products')->update(['currency'=>'USD']);
        try{$this->store->quote([1=>1]);self::fail('Mixed currency accepted');}catch(CommerceException $e){self::assertSame(422,$e->getCode());}
    }
}
