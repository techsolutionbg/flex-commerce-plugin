<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Flex\Contracts\Http\ResponseFactoryInterface;
use Psr\Http\Message\{ResponseInterface, ServerRequestInterface};

final readonly class LegacyStorefrontRedirectController
{
    public function __construct(private ResponseFactoryInterface $responses) {}

    public function __invoke(ServerRequestInterface $request, array $arguments = []): ResponseInterface
    {
        $path = $request->getUri()->getPath();
        $slug = isset($arguments['slug']) ? rawurlencode((string) $arguments['slug']) : '';
        $target = match (true) {
            str_starts_with($path, '/plugins/flex/commerce/product/') => '/product/' . $slug,
            str_starts_with($path, '/plugins/flex/commerce/catalog/category/') => '/catalog/category/' . $slug,
            str_ends_with($path, '/catalog') => '/catalog',
            str_ends_with($path, '/cart') => '/cart',
            str_ends_with($path, '/favourites') => '/favourites',
            default => '/',
        };
        $query = $request->getUri()->getQuery();
        if ($query !== '') {
            $target .= '?' . $query;
        }

        return $this->responses->text('', 301, ['Location' => $target]);
    }
}
