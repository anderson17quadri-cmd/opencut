---
name: editor-com-plano
description: Edita qualquer vídeo no OpenCut como um editor profissional que primeiro assiste, entende o tipo de vídeo (explicação, comparação, tutorial, vlog, review, podcast, anúncio, história, montagem) e monta um plano com tempos antes de editar. Use sempre que o usuário pedir para editar um vídeo com o OpenCut aberto, a não ser que peça outro estilo.
---

# Editor com plano (OpenCut)

Você edita usando **somente as ferramentas da extensão OpenCut** (o app OpenCut precisa estar aberto no PC do usuário). Nunca use outro programa nem código fora do OpenCut.

## 1. Assista antes de mexer
1. Chame `get_style_guide` com `style: "automatico"` e siga o guia **à risca**. Ele é atualizado junto com o app.
2. Crie um projeto novo, ache o vídeo com `list_media_files`, `add_media` e `add_to_timeline`.
3. Assista: `view_frames` em 8 momentos, `transcribe` com `words: true` e, se o vídeo tiver cortes, `detect_scenes`.

## 2. Diagnóstico
Anote:
- **Tipo:** explicação, comparação, tutorial, vlog, review, podcast/entrevista, anúncio, história ou montagem.
- **Imagem e som:** enquadramento, tripé ou mão, luz, fundo e ruído.
- **Conteúdo:** frase-gancho, 2 a 5 momentos-chave com o tempo, marcas, números e listas citados, tomadas repetidas e a chamada final.
- **Tom:** premium, divertido, educativo ou emocional.

## 3. Plano com tempos
Monte o roteiro de edição batida por batida, no formato "tempo → o que é dito → o que aparece".
- Algo muda a cada 2 a 4 segundos.
- Um elemento por vez, além da legenda.
- O efeito ilustra o que está sendo dito naquele momento.
- Deixe respiros, para os momentos fortes se destacarem.

Mostre ao usuário o diagnóstico e o plano em até 10 linhas. Depois edite seguindo a receita do tipo que está no guia. O que o usuário pedir vale mais que a receita.

## 4. Acabamento
- Confira cada efeito com `view_frames`: rosto livre e texto dentro das margens.
- Rode `master_audio` (-14 LUFS).
- Exporte com `export_video` em qualidade "very_high".
- Conte ao usuário as decisões em poucas linhas.

## Regras que nunca mudam
- Nada de fotos aleatórias. Só mostre imagem do que a pessoa realmente apresenta.
- Sem recorte nem troca de fundo, a não ser que o usuário peça.
- Nunca amplie selfie ou vlog, porque borra. Projeto em 9:16 e 30 fps.
- A cor com `apply_look` depende da luz:
  - "noturno" só para gravação de tripé com parede clara;
  - "filme" ou "limpo" para luz do dia e pessoas.
- Corrija palavras mal ouvidas na legenda antes de gerar.
- Música: você não consegue ouvir as faixas. Em vídeo falado, o padrão é **sem música**: sugira ao usuário pôr uma música em alta no próprio Instagram/TikTok, baixinha, na hora de postar. Nunca use faixas "chill", lo-fi, "upbeat", corporativas ou motivacionais, porque soam como anúncio de vendedor de curso. Se o usuário pedir música, use só fundo ambiente sem batida, bem baixo, e diga o nome da faixa.
- No máximo dois estilos de enquadramento por vídeo, e o rosto sempre no mesmo lugar entre os cortes.
- Efeito pedido pela pessoa (fogo, fumaça, faíscas) deve parecer real: vídeo do elemento em fundo preto com mesclagem "screen" seguindo a mão. Emoji animado só em vídeo divertido.
