<?php
declare(strict_types=1);
namespace Flex\Commerce;
use Flex\Contracts\Configuration\ConfigRepositoryInterface;
use Illuminate\Database\Eloquent\Model;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Mime\{Email, Address};
final readonly class OrderNotifications
{
    public function __construct(private MailerInterface $mailer, private ConfigRepositoryInterface $config) {}
    public function confirmation(array $order): void
    {
        if (!Model::resolveConnection()->table('flex_commerce_orders')->where('id',$order['id'])->whereNull('notified_at')->update(['notified_at'=>gmdate('Y-m-d H:i:s')])) return;
        $s = (new CatalogStore())->settings();
        $body = 'Получихме поръчка '.$order['number'].".\n\n";
        foreach ($order['items'] as $item) $body .= $item['name'].' × '.$item['quantity'].' — '.number_format($item['line_minor']/100,2,',',' ').' '.$order['currency']."\n";
        $body .= "\nДоставка: ".number_format($order['shipping_minor']/100,2,',',' ').' '.$order['currency']."\nОбщо: ".number_format($order['total_minor']/100,2,',',' ').' '.$order['currency']."\nПлащане: наложен платеж.\n";
        $c=$order['customer']; $body.="\n".$c['first_name'].' '.$c['last_name']."\n".$c['city'].' '.$c['postcode'].', '.$c['address']."\nТелефон: ".$c['phone'];
        if ($s['order_email_customer']) $this->send($c['email'],'Потвърждение на поръчка '.$order['number'],$body);
        if ($s['order_admin_email'] !== '') $this->send($s['order_admin_email'],'Нова поръчка '.$order['number'],$body."\nБележка: ".$c['note']);
    }
    private function send(string $to,string $subject,string $body): void
    {
        try { $this->mailer->send((new Email())->from(new Address($this->config->string('mail.from.address'),$this->config->string('mail.from.name')))->to($to)->subject($subject)->text($body)); }
        catch (\Throwable) { error_log('Flex Commerce: order email delivery failed.'); }
    }
}
