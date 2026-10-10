<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Flex\Contracts\Http\ResponseFactoryInterface;
use Flex\Contracts\Session\SessionInterface;
use Flex\Http\RequestInput;
use Flex\Session\CsrfTokenManager;
use Flex\Settings\SectionSettings;
use Psr\Http\Message\{ResponseInterface, ServerRequestInterface};

final readonly class CartController
{
    public function __construct(private ResponseFactoryInterface $responses, private SessionInterface $session, private RequestInput $input, private CsrfTokenManager $csrf, private SectionSettings $settings) {}
    public function __invoke(ServerRequestInterface $request): ResponseInterface
    {
        $store = new CartStore();
        $cart = $store->quantities((array) $this->session->get('flex_commerce_cart', []));
        $this->session->put('flex_commerce_cart', $cart);
        $productId = (int) ($request->getQueryParams()['product_id'] ?? 0);
        try {
            if (($this->settings->all('public')['closed'] ?? '0') === '1') {
                throw new CommerceException('Магазинът временно е затворен.', 503);
            }
            if ($request->getMethod() === 'POST') {
                $input = $this->input->all($request);
                if (($input['action'] ?? 'add') === 'remove') {
                    $id = filter_var($input['product_id'] ?? null, FILTER_VALIDATE_INT);
                    if (!is_int($id) || $id < 1) {
                        throw new CommerceException('Невалиден продукт.', 422);
                    }
                    unset($cart[$id]);
                } elseif (($input['action'] ?? 'add') === 'set') {
                    $cart = $store->setQuantity($cart, $input['product_id'] ?? null, $input['quantity'] ?? null);
                } elseif (($input['action'] ?? 'add') === 'add') {
                    $cart = $store->add($cart, $input['product_id'] ?? null, $input['quantity'] ?? null);
                } else {
                    throw new CommerceException('Невалидно действие.', 422);
                }
                $this->session->put('flex_commerce_cart', $cart);
            }
            return $this->responses->json(['cart' => $store->summary($cart), 'csrf_token' => $this->csrf->token(), 'stock' => $store->stock($productId)], 200, ['Cache-Control' => 'no-store']);
        } catch (CommerceException $error) {
            return $this->responses->json(['error' => ['message' => $error->getMessage()], 'cart' => $store->summary($cart), 'stock' => $store->stock($productId)], $error->getCode(), ['Cache-Control' => 'no-store']);
        }
    }
}
