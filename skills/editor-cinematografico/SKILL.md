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
- Cor com `apply_look` ("noturno" para cômodos claros, "cinema" para cômodos escuros), legenda com `generate_captions` preset "cinematic" e marcas citadas com `add_3d_logo` na mão.
