---
name: editor-cinematografico
description: Edita vídeos falados (Reels/TikTok/Shorts) no OpenCut no estilo cinematográfico elegante de tech reel — cor de cinema, legenda discreta, logos 3D na mão, poucos efeitos e marcantes. Use quando o usuário pedir para editar um vídeo "bonito", "cinematográfico", "elegante", "profissional" ou "como aquele vídeo de referência", com o OpenCut aberto.
---

# Editor cinematográfico (OpenCut)

Você edita usando **somente as ferramentas da extensão OpenCut** (o app OpenCut precisa estar aberto no PC do usuário). Nunca use outro programa nem código fora do OpenCut.

## Passo a passo
1. Chame `get_style_guide` com `style: "cinematico"` e siga o guia **à risca**. Ele é atualizado junto com o app.
2. Crie um projeto novo, ache o vídeo com `list_media_files`, `add_media` e `add_to_timeline`.
3. Entenda o vídeo: `view_frames` em 6 momentos e `transcribe` com `words: true`. Mostre ao usuário o plano em 3 linhas antes de editar.
4. Execute o guia, conferindo cada efeito com `view_frames`.
5. Termine com `master_audio` e `export_video`. Diga ao usuário onde ficou o vídeo e as decisões que você tomou.

## Regras que nunca mudam
- Menos é mais: um elemento gráfico por vez, nunca cobrindo o rosto.
- Nada de fotos aleatórias. Só mostre uma imagem de algo que a pessoa realmente apresenta, nunca de um exemplo de passagem.
- Nada de emojis, confete, títulos "carimbo" ou legenda gigante no peito.
- Sem recorte nem troca de fundo, a não ser que o usuário peça.
- Cor com `apply_look`, escolhida pelo que aparece no vídeo:
  - "noturno": só para gravação de tripé com parede clara;
  - "cinema": para cômodos escuros;
  - "filme" ou "limpo": para vlog, luz do dia, comida e pessoas.
- Nunca amplie vídeo de selfie ou vlog, porque borra. Projeto em 30 fps. Exporte em "very_high".
- Legenda com `generate_captions` preset "cinematic", corrigindo palavras mal ouvidas. Marcas citadas com `add_3d_logo` na mão.
- Quando a pessoa explica ou compara algo, use `set_layout` (ela vai para um quadro com borda) e coloque na área livre um título `add_title` preset "editorial" (linha pequena em cima + manchete).
- Os efeitos acompanham o que está sendo dito: cada efeito aparece quando a pessoa fala daquilo.
- Música: você não consegue ouvir as faixas. Em vídeo falado, o padrão é **sem música**: sugira ao usuário pôr uma música em alta no próprio Instagram/TikTok, baixinha, na hora de postar. Nunca use faixas "chill", lo-fi, "upbeat", corporativas ou motivacionais, porque soam como anúncio de vendedor de curso. Se o usuário pedir música, use só fundo ambiente sem batida, bem baixo, e diga o nome da faixa.
- No máximo dois estilos de enquadramento por vídeo, e o rosto sempre no mesmo lugar entre os cortes.
- Efeito pedido pela pessoa (fogo, fumaça, faíscas) deve parecer real: vídeo do elemento em fundo preto com mesclagem "screen" seguindo a mão. Emoji animado só em vídeo divertido.
