<?php

declare(strict_types=1);

namespace Flex\Commerce;

use Flex\Contracts\Http\ResponseFactoryInterface;
use Flex\Extension\V1\ExtensionApiInterface;
use Flex\Http\RequestInput;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

final readonly class CatalogController
{
    public function __construct(private ResponseFactoryInterface $responses, private RequestInput $input, private ?ExtensionApiInterface $extensions = null) {}

    /** @param array<string, string> $arguments */
    public function __invoke(ServerRequestInterface $request, array $arguments = []): ResponseInterface
    {
        $store = new CatalogStore();
        $kind = str_contains($request->getUri()->getPath(), '/categories') ? 'categories' : 'products';
        try {
            if (preg_match('~/sales(?:/[0-9]+)?$~', $request->getUri()->getPath())) {
                $sales = new SalesStore();
                if ($request->getMethod() === 'POST') $sales->record($this->input->all($request));
                if ($request->getMethod() === 'PUT') $sales->cancel((int) ($arguments['id'] ?? 0), $this->input->all($request)['cancelled'] ?? null);
                return $this->responses->json($sales->report(), 200, ['Cache-Control' => 'no-store']);
            }
            if (str_ends_with($request->getUri()->getPath(), '/settings')) {
                $settings = $request->getMethod() === 'GET' ? $store->settings() : $store->saveSettings($this->input->all($request));
                return $this->responses->json(['settings' => $settings], 200, ['Cache-Control' => 'no-store']);
            }
            $id = isset($arguments['id']) ? filter_var($arguments['id'], FILTER_VALIDATE_INT) : null;
            if ($id !== null && (!is_int($id) || $id < 1)) {
                throw new CommerceException('Невалиден идентификатор.', 422);
            }
            $method = $request->getMethod();
            $body = $method === 'GET' ? [] : $this->input->all($request);
            $view = $request->getQueryParams()['view'] ?? 'active';
            if (!is_string($view)) {
                throw new CommerceException('Невалиден изглед.', 422);
            }
            if ($method === 'GET') {
                $result = $id === null
                    ? ['records' => $store->index($kind, $view)]
                    : ['record' => $store->get($kind, $id)];
            } elseif ($method === 'DELETE' || ($method === 'POST' && $id !== null)) {
                $action = $arguments['action'] ?? 'trash';
                $store->action($kind, $id ?? 0, $action, $body['version'] ?? null);
                if ($action === 'force') {
                    // Lets other plugins remove their data for the deleted product or category (for example Flex SEO).
                    $this->extensions?->doAction('commerce.catalog.deleted', ['kind' => $kind === 'products' ? 'product' : 'category', 'id' => $id ?? 0]);
                }
                $result = ['ok' => true];
            } else {
                $result = ['record' => $store->save($kind, $body, $id)];
            }
            return $this->responses->json($result, $method === 'POST' && $id === null ? 201 : 200, ['Cache-Control' => 'no-store']);
        } catch (CommerceException $error) {
            return $this->responses->json(['error' => ['message' => $error->getMessage()]], $error->getCode(), ['Cache-Control' => 'no-store']);
        } catch (\Illuminate\Database\UniqueConstraintViolationException) {
            return $this->responses->json(['error' => ['message' => 'Идентификаторът е зает от друга заявка. Опитайте отново.']], 409, ['Cache-Control' => 'no-store']);
        }
    }
}
