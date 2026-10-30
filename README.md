# Vídeo para GIF

Converta trechos de vídeo em GIFs animados **direto no navegador**. O vídeo não é enviado para nenhum servidor: tudo acontece no seu aparelho.

**Usar agora:** https://guilhermecorrea77.github.io/video-to-gif-converter/

## O que dá para fazer

- **Escolher o trecho** numa linha do tempo com miniaturas: arraste as alças, digite os tempos ou use os atalhos `I` (início) e `O` (fim).
- **Prévia ao vivo** já com corte, filtros e legenda; `Espaço` toca o trecho em loop.
- **Pontos de partida:** WhatsApp (leve), Equilibrado e Alta qualidade.
- **Tamanho e fluidez:** largura de 240 a 800 px, de 8 a 25 quadros por segundo, de 32 a 256 cores.
- **Enquadramento:** original, 1:1, 4:5, 9:16 (stories) ou 16:9, cortado a partir do centro.
- **Movimento:** velocidade de 0,5× a 2×, ao contrário, vai e volta, e repetir sempre, 1 vez ou 3 vezes.
- **Efeitos:** P&B, sépia, vibrante, retrô, negativo, brilho e contraste.
- **Legenda** estilo meme, em cima ou embaixo, com tamanho e cor.
- **Figurinha animada do WhatsApp:** salva em WebP 512 × 512, até 10 s e 500 KB (a qualidade é ajustada sozinha para caber), cortando em quadrado ou com o vídeo inteiro e sobras transparentes.
- **Baixar ou compartilhar** (no celular abre a lista de apps, como o WhatsApp).
- **Histórico da sessão** com os GIFs gerados, até fechar a aba.
- Abrir o vídeo arrastando para a página ou colando com `Ctrl+V`.

## Rodar no computador

Requisito: Node.js 20 ou mais novo.

```bash
npm install
npm run dev      # http://localhost:3000
```

Gerar a versão de produção (pasta `dist/`):

```bash
npm run build
npm run preview
```

## Publicar no GitHub Pages

O workflow em `.github/workflows/deploy.yml` publica o site a cada push na `main`.
Na primeira vez, ative em **Settings → Pages → Source: GitHub Actions**.

## Como funciona

1. O vídeo é lido por um `<video>` local; cada quadro é buscado no tempo exato e desenhado num `<canvas>` com corte, filtros e legenda (`src/lib/render.ts`).
2. Os pixels vão para um **Web Worker** (`src/workers/gif.worker.ts`) que reduz as cores e monta o GIF com [gifenc](https://github.com/mattdesl/gifenc). A tela continua respondendo e dá para cancelar.
3. O tempo de cada quadro é arredondado sobre o tempo acumulado: a duração do GIF bate com a do trecho, sem acelerar nem atrasar.

## Estrutura

```
src/
  App.tsx                 estado geral, conversão e histórico
  components/
    DropZone.tsx          tela inicial
    Editor.tsx            prévia, reprodução e linha do tempo
    SettingsPanel.tsx     ajustes
    Result.tsx            GIF pronto e histórico
    ui.tsx                botões de escolha, sliders e seções
  lib/
    convert.ts            leitura dos quadros (com plano B para celular), GIF e figurinha
    webp.ts               montagem do WebP animado da figurinha
    render.ts             enquadramento, filtros e legenda
    settings.ts           ajustes, atalhos e limites
    format.ts             tamanhos, tempos e miniaturas
  workers/gif.worker.ts   codificação do GIF
```

## Figurinha no WhatsApp

O criador de figurinhas do próprio WhatsApp só faz figurinhas paradas. Para usar a figurinha animada, importe o arquivo `.webp` num app de pacotes de figurinhas (como o Sticker.ly) e adicione o pacote ao WhatsApp pelo botão **+** da bandeja de figurinhas. Se o app não aceitar WebP, use a versão GIF.

A geração de WebP depende do navegador: funciona no Chrome, Edge e Firefox (computador e Android). O Safari do iPhone não gera WebP, então lá a opção avisa e sugere o GIF.

## Limites

- Até 600 quadros por GIF (para não faltar memória no celular).
- O formato do vídeo precisa ser aceito pelo navegador: MP4 (H.264) e WebM funcionam em quase todos; MOV do iPhone funciona no Safari.
