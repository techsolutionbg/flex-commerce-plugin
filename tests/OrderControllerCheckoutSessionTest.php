<?php

declare(strict_types=1);

namespace Flex\Commerce\Tests;

use Flex\Commerce\OrderController;
use Flex\Tests\Support\ArraySession;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../src/OrderController.php';

final class OrderControllerCheckoutSessionTest extends TestCase
{
    public function testPreviousKeyReplayPreservesTheNewCartAndCheckoutKey(): void
    {
        $session = new ArraySession();
        $current = str_repeat('a', 64);
        $previous = str_repeat('b', 64);
        $session->put('flex_commerce_checkout_key', $current);
        $session->put('flex_commerce_previous_key', $previous);
        $session->put('flex_commerce_cart', [1 => 2]);

        OrderController::finalizeCheckoutSession($session, $previous, $current);

        self::assertSame([1 => 2], $session->get('flex_commerce_cart'));
        self::assertSame($previous, $session->get('flex_commerce_previous_key'));
        self::assertSame($current, $session->get('flex_commerce_checkout_key'));
        self::assertIsString($session->get('flex_commerce_checkout_key'));
        self::assertSame(64, strlen((string) $session->get('flex_commerce_checkout_key')));
    }

    public function testCurrentKeyPlaceStoresPreviousAndRotates(): void
    {
        $session = new ArraySession();
        $current = str_repeat('c', 64);
        $session->put('flex_commerce_checkout_key', $current);
        $session->put('flex_commerce_cart', [3 => 1]);

        OrderController::finalizeCheckoutSession($session, $current, $current);

        self::assertSame([], $session->get('flex_commerce_cart'));
        self::assertSame($current, $session->get('flex_commerce_previous_key'));
        self::assertNotSame($current, $session->get('flex_commerce_checkout_key'));
    }
}
