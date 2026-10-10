<?php
declare(strict_types=1);
namespace Flex\Commerce;
use Flex\Contracts\Http\ResponseFactoryInterface;
use Flex\Contracts\Session\SessionInterface;
use Flex\Extension\V1\ExtensionApiInterface;
use Flex\Http\RequestInput;
use Flex\Session\CsrfTokenManager;
use Flex\Settings\SectionSettings;
use Psr\Http\Message\{ResponseInterface, ServerRequestInterface};

final readonly class OrderController
{
    /** How long /order-received stays available after checkout (seconds). */
    private const ORDER_RECEIVED_TTL = 1800;

    public function __construct(
        private ResponseFactoryInterface $responses,
        private SessionInterface $session,
        private RequestInput $input,
        private CsrfTokenManager $csrf,
        private SectionSettings $settings,
        private StorefrontController $storefront,
        private OrderNotifications $notifications,
        private ExtensionApiInterface $extensions,
    ) {}

    public function __invoke(ServerRequestInterface $request, array $arguments = []): ResponseInterface
    {
        $store = new OrderStore(null, $this->extensions);
        $path = $request->getUri()->getPath();
        try {
            if (str_starts_with($path, '/admin/')) {
                $id = (int) ($arguments['id'] ?? 0);
                if ($request->getMethod() === 'PUT') {
                    return $this->responses->json(['record' => $store->update($id, $this->input->all($request), $request->getAttribute('auth.user')?->id)], 200, ['Cache-Control' => 'no-store']);
                }

                return $this->responses->json($id ? ['record' => $store->get($id)] : $store->listing($request->getQueryParams()), 200, ['Cache-Control' => 'no-store']);
            }
            if (($this->settings->all('public')['closed'] ?? '0') === '1') {
                throw new CommerceException('Магазинът временно е затворен.', 503);
            }
            if ($path === '/order-received') {
                return $this->orderReceivedPage($store);
            }
            if ($path === '/checkout') {
                return $this->storefront->checkoutPage();
            }
            $key = $this->session->get('flex_commerce_checkout_key');
            if (!is_string($key)) {
                $key = bin2hex(random_bytes(32));
                $this->session->put('flex_commerce_checkout_key', $key);
            }
            $cart = (array) $this->session->get('flex_commerce_cart', []);
            if ($request->getMethod() === 'POST') {
                $input = $this->input->all($request);
                $submitted = $input['request_key'] ?? '';
                if (!is_string($submitted) || (!hash_equals($key, $submitted) && !hash_equals((string) $this->session->get('flex_commerce_previous_key', ''), $submitted))) {
                    throw new CommerceException('Заявката е изтекла. Презаредете страницата.', 409);
                }
                $order = $store->place($cart, $input, $submitted);
                self::finalizeCheckoutSession($this->session, $submitted, $key);
                $this->session->put('flex_commerce_last_order', $order['id']);
                $this->session->put('flex_commerce_last_order_at', time());
                $this->notifications->confirmation($order);

                return $this->responses->json(['url' => '/order-received', 'number' => $order['number']], 201, ['Cache-Control' => 'no-store']);
            }
            $selection = $this->selectionFromRequest($request);

            $payload = [
                'quote' => $store->quote($cart, $selection),
                'request_key' => $key,
                'csrf_token' => $this->csrf->token(),
            ];
            $filtered = $this->extensions->applyFilters('commerce.checkout.data', $payload, [
                'cart' => $cart,
                'selection' => $selection,
            ]);

            return $this->responses->json(is_array($filtered) ? $filtered : $payload, 200, ['Cache-Control' => 'no-store']);
        } catch (CommerceException $error) {
            if ($path === '/order-received') {
                return $this->forgetOrderReceived();
            }
            if ($path === '/checkout') {
                return $this->storefront->orderError($error->getMessage(), $error->getCode());
            }

            return $this->responses->json(['error' => ['message' => $error->getMessage()]], $error->getCode(), ['Cache-Control' => 'no-store']);
        }
    }

    /** A replay acknowledges the old order without changing a newer cart or checkout key. */
    public static function finalizeCheckoutSession(SessionInterface $session, string $submitted, string $currentKey): void
    {
        if (!hash_equals($currentKey, $submitted)) {
            return;
        }
        $session->put('flex_commerce_cart', []);
        if (hash_equals($currentKey, $submitted)) {
            $session->put('flex_commerce_previous_key', $currentKey);
        }
        $session->put('flex_commerce_checkout_key', bin2hex(random_bytes(32)));
    }

    /** @return array{shipping: string, shipping_meta: array<string, mixed>} */
    private function selectionFromRequest(ServerRequestInterface $request): array
    {
        $query = $request->getQueryParams();
        $shipping = is_string($query['shipping'] ?? null) && $query['shipping'] !== '' ? $query['shipping'] : OrderStore::METHOD_ADDRESS;
        $meta = [];
        if (isset($query['shipping_meta']) && is_string($query['shipping_meta'])) {
            $decoded = json_decode($query['shipping_meta'], true);
            if (is_array($decoded)) {
                $meta = $decoded;
            }
        }
        if (is_string($query['office_code'] ?? null) && trim($query['office_code']) !== '') {
            $meta['office_code'] = trim($query['office_code']);
        }

        return ['shipping' => $shipping, 'shipping_meta' => $meta];
    }

    private function orderReceivedPage(OrderStore $store): ResponseInterface
    {
        $id = (int) $this->session->get('flex_commerce_last_order', 0);
        $at = (int) $this->session->get('flex_commerce_last_order_at', 0);
        if ($id < 1 || $at < 1 || (time() - $at) > self::ORDER_RECEIVED_TTL) {
            return $this->forgetOrderReceived();
        }
        try {
            return $this->storefront->orderPage($store->get($id), $at + self::ORDER_RECEIVED_TTL);
        } catch (CommerceException) {
            return $this->forgetOrderReceived();
        }
    }

    private function forgetOrderReceived(): ResponseInterface
    {
        $this->session->remove('flex_commerce_last_order');
        $this->session->remove('flex_commerce_last_order_at');

        return $this->responses->text('', 302, ['Location' => '/', 'Cache-Control' => 'no-store']);
    }
}
