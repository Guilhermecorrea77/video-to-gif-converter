# Fábrica de Figurinhas

Transforme **vídeo, GIF ou foto** em **figurinha do WhatsApp**, animada ou parada, direto no navegador. Também salva em GIF.
Nada é enviado para servidores: tudo acontece no seu aparelho.

**Usar agora:** https://guilhermecorrea77.github.io/video-to-gif-converter/

## O que entra

| Arquivo | Vira |
|---|---|
| Vídeo (MP4, MOV, WebM) | figurinha animada ou GIF, do trecho que você escolher |
| GIF, WebP animado, PNG animado (APNG) | figurinha animada ou GIF, com corte, velocidade, legenda… |
| Foto (JPG, PNG, WebP parado) | figurinha estática ou GIF de 1 quadro |

## O que sai

- **Figurinha animada:** WebP 512 × 512, até 10 s e 500 KB, como o WhatsApp exige. A qualidade é ajustada sozinha para caber.
- **Figurinha estática:** WebP 512 × 512, até 100 KB.
- **GIF:** largura de 240 a 800 px, de 8 a 25 quadros por segundo, de 32 a 256 cores.

Para figurinha, escolha **Cortar** (preenche o quadrado) ou **Inteiro** (mostra tudo, com sobras transparentes).

## Recursos

- Linha do tempo com miniaturas e alças para escolher o trecho (atalhos `I`, `O` e `Espaço`).
- Prévia ao vivo com corte, filtros e legenda.
- Velocidade de 0,5× a 2×, reverso e vai e volta.
- Filtros (P&B, sépia, vibrante, retrô, negativo), brilho e contraste.
- Legenda estilo meme, em cima ou embaixo.
- Histórico do que foi gerado na sessão.
- Abrir arquivo arrastando para a página ou colando com `Ctrl+V`.
- Funciona também dentro do Claude (o botão Baixar usa a confirmação de download de lá).

## Figurinha no WhatsApp

O criador de figurinhas do próprio WhatsApp só faz figurinhas paradas. Para a animada, importe o arquivo `.webp` num app de pacotes de figurinhas (como o Sticker.ly) e adicione o pacote ao WhatsApp pelo botão **+** da bandeja de figurinhas. Se o app não aceitar WebP, use a versão GIF.

A figurinha (WebP) é gerada no Chrome, Edge e Firefox, no computador e no Android. O Safari do iPhone não gera WebP: lá o app começa em GIF e avisa.

## Rodar no computador

Requisito: Node.js 20 ou mais novo.

```bash
npm install
npm run dev      # http://localhost:3000
```

Versão de produção (pasta `dist/`):

```bash
npm run build
npm run preview
```

## Publicar no GitHub Pages

O workflow em `.github/workflows/deploy.yml` publica o site a cada push na `main`.
Na primeira vez, ative em **Settings → Pages → Source: GitHub Actions**.

## Como funciona

1. **Abrir:** vídeos são lidos por um `<video>` local. GIF/WebP/APNG são decodificados pelo `ImageDecoder` do navegador; onde ele não existe, GIFs são decodificados em JavaScript ([omggif](https://github.com/deanm/omggif)) (`src/lib/source.ts`).
2. **Ler os quadros:** cada instante é desenhado num `<canvas>` com corte, filtros e legenda (`src/lib/render.ts`). No celular, se buscar um instante do vídeo não trouxer a imagem nova, o app toca o trecho e captura os quadros enquanto ele passa (`src/lib/convert.ts`).
3. **GIF:** um Web Worker reduz as cores e monta o arquivo com [gifenc](https://github.com/mattdesl/gifenc) (`src/workers/gif.worker.ts`).
4. **Figurinha:** cada quadro vira WebP pelo próprio navegador e os quadros são juntados num WebP animado (`src/lib/webp.ts`).

## Estrutura

```
src/
  App.tsx                 estado geral, conversão e histórico
  components/
    DropZone.tsx          tela inicial
    Editor.tsx            prévia, reprodução e linha do tempo
    SettingsPanel.tsx     ajustes
    Result.tsx            resultado e histórico
    ui.tsx                botões de escolha, sliders e seções
  lib/
    source.ts             abre vídeo, GIF, WebP/PNG animado ou foto
    convert.ts            leitura dos quadros, GIF e figurinha
    render.ts             enquadramento, filtros e legenda
    webp.ts               montagem do WebP animado
    settings.ts           ajustes, atalhos e limites
    save.ts               baixar no navegador ou dentro do Claude
    format.ts             tamanhos, tempos e miniaturas
  workers/gif.worker.ts   codificação do GIF
```

## Limites

- Até 600 quadros por conversão (para não faltar memória no celular).
- O vídeo precisa estar num formato que o navegador abre: MP4 (H.264) e WebM funcionam em quase todos; MOV do iPhone funciona no Safari.
