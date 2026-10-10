<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Flex\Pages\Page;
use Illuminate\Database\Eloquent\Model;

/**
 * Ensures the storefront has a standard Econt shipping information page
 * and points commerce shipping_terms_url at it when unset.
 */
final class StorefrontPages
{
    public const SHIPPING_SLUG = 'dostavka-econt';

    public function ensure(): void
    {
        $db = Model::resolveConnection();
        if (!$db->getSchemaBuilder()->hasTable('pages')) {
            return;
        }

        if (!Page::withTrashed()->where('slug', self::SHIPPING_SLUG)->exists()) {
            $now = gmdate('Y-m-d H:i:s');
            Page::query()->create([
                'title' => 'Доставка с Еконт',
                'slug' => self::SHIPPING_SLUG,
                'content' => $this->econtShippingHtml(),
                'status' => 'draft',
                'published_at' => null,
                'settings' => [],
                'blocks' => [],
            ]);
        }

        if (!$db->getSchemaBuilder()->hasTable('flex_commerce_settings')) {
            return;
        }

        $row = $db->table('flex_commerce_settings')->where('id', 1)->first();
        if ($row === null) {
            return;
        }

        $values = json_decode((string) $row->values, true);
        if (!is_array($values)) {
            $values = [];
        }
        if (trim((string) ($values['shipping_terms_url'] ?? '')) !== '') {
            return;
        }

        $page = Page::query()->where('slug', self::SHIPPING_SLUG)->where('status', 'published')->whereNotNull('published_at')->where('published_at', '<=', gmdate('Y-m-d H:i:s'))->first();
        if ($page === null) {
            return;
        }
        $values['shipping_terms_url'] = '/' . self::SHIPPING_SLUG;
        $db->table('flex_commerce_settings')->where('id', 1)->update([
            'values' => json_encode($values, JSON_UNESCAPED_UNICODE),
        ]);
    }

    private function econtShippingHtml(): string
    {
        return <<<'HTML'
<p>Доставяме поръчките в България чрез куриерска компания <strong>Еконт</strong>. На тази страница ще намерите основната информация за срокове, начини на получаване и плащане.</p>

<h2>Начини на доставка</h2>
<ul>
<li><strong>До офис на Еконт</strong> – получавате пратката в избран от вас офис. Това обикновено е най-удобният и изгоден вариант.</li>
<li><strong>До адрес</strong> – куриерът доставя пратката до посочения от вас адрес.</li>
</ul>
<p>При поръчка посочете предпочитания начин на доставка и точни данни за получаване. Можете да проверите офисите на Еконт на <a href="https://www.econt.com/offices" target="_blank" rel="noopener">econt.com/offices</a>.</p>

<h2>Срок за доставка</h2>
<ul>
<li>За населени места с офис на Еконт пратките обикновено пристигат на <strong>следващия работен ден</strong> след предаване на пратката към куриера.</li>
<li>За населени места без офис на Еконт срокът е според графика на обслужване – обикновено до <strong>3 работни дни</strong>.</li>
</ul>
<p>Срокът започва да тече след като поръчката е потвърдена и предадена за изпращане. В пикови периоди или при непълни данни за адрес доставката може да се забави.</p>

<h2>Плащане при доставка</h2>
<p>Приемаме <strong>наложен платеж</strong>. Заплащате стойността на поръчката (продукти + доставка, ако е приложимо) при получаване на пратката:</p>
<ul>
<li>в брой в офис на Еконт или на куриера;</li>
<li>с банкова карта чрез ПОС терминал, където е наличен.</li>
</ul>
<p>Пратката се предава след успешно плащане на дължимата сума.</p>

<h2>Цена на доставката</h2>
<p>Цената за доставка се изчислява според актуалните настройки на магазина и се показва ясно в количката и при завършване на поръчката. При достигане на зададен праг за безплатна доставка таксата за доставка може да отпадне.</p>

<h2>Проследяване на пратката</h2>
<p>След изпращане ще получите информация за пратката (включително номер за проследяване, когато е наличен). Можете да следите статуса през клиентския център на Еконт: <a href="https://www.econt.com/services/track-shipment" target="_blank" rel="noopener">Проследяване на пратка</a>.</p>

<h2>Получаване и преглед</h2>
<ul>
<li>Проверете пратката при получаване за видими повреди по опаковката.</li>
<li>При съмнение за увреждане поискайте протокол от куриера/офиса на Еконт, преди да приемете пратката.</li>
<li>Ако не можете да получите пратката в посочения срок, свържете се с нас или с Еконт за пренасочване/повторна доставка според правилата на куриера.</li>
</ul>

<h2>Връзка с нас</h2>
<p>При въпроси относно вашата поръчка или доставката се свържете с нас чрез данните за контакт в сайта. За въпроси, свързани конкретно с куриерската услуга, можете да се обърнете и към Еконт на <a href="https://www.econt.com" target="_blank" rel="noopener">econt.com</a> или телефон <a href="tel:070017300">0700 1 7300</a>.</p>
HTML;
    }
}
