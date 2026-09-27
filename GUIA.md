# Guia do OpenCut + Claude

Tudo o que o Claude sabe fazer no OpenCut, o que cada ferramenta faz e quando
ela é usada. Você não precisa decorar os nomes: basta pedir em português
(“corta as pausas”, “coloca legenda amarela”…). O Claude escolhe a
ferramenta certa. Os nomes entre `crases` servem para você entender o que ele
está fazendo.

> **Como usar:** abra o OpenCut, abra o Claude Desktop (com a extensão
> OpenCut instalada) e peça. Tudo acontece ao vivo na janela do OpenCut e
> dá para desfazer com **Ctrl+Z**.

---

## ⭐ Estilos prontos (as "skills")

O jeito mais fácil de ter uma edição bonita é pedir um **estilo pronto**. O Claude segue um guia de diretor, passo a passo, em vez de inventar.

| Estilo | Como é | Como pedir |
|---|---|---|
| **Com plano (recomendado)** | O Claude **assiste o vídeo primeiro**, descobre o tipo (explicação, comparação, tutorial, vlog, review, podcast, anúncio, história, montagem), anota luz, som e momentos-chave, **monta um plano com os tempos** e te mostra antes de editar. Cada tipo tem sua receita | **+** → **OpenCut** → **"Editar com plano (se adapta ao vídeo)"**. Ou escreva: *"edita o vídeo X"* |
| **Cinematográfico** | Elegante, estilo "tech reel" de criador grande: **cor de cinema** (sem recorte), **legenda pequena e discreta**, **logos 3D brilhando na sua mão**, zooms suaves, música calma. Poucos efeitos, todos marcantes. Nada de emoji, foto aleatória ou legenda gigante | No Claude Desktop, clique em **+** → **OpenCut** → **"Editar no estilo cinematográfico"** e escreva o nome do vídeo. Ou escreva: *"edita o vídeo X no estilo cinematográfico"* |
| **Reels viral** | Rápido e chamativo: zoom a cada frase, legenda estilo Hormozi, títulos, emojis animados, efeitos sonoros | **+** → **OpenCut** → **"Editar Reels dinâmico (viral)"** |

**Skills para o Claude Desktop (opcional):** os arquivos `skills/editor-com-plano.zip` e `skills/editor-cinematografico.zip` podem ser instalados em **Configurações → Capacidades → Skills → Enviar skill**. O primeiro faz o Claude sempre assistir e planejar antes de editar; o segundo entra quando você pedir um vídeo "bonito" ou "profissional".

---

## 1. Projeto e arquivos

| Ferramenta | O que faz | Quando usar | Exemplo de pedido |
|---|---|---|---|
| `get_state` | Mostra ao Claude tudo o que está no projeto (clipes, tempos, posições, efeitos) | O Claude usa antes de editar | — |
| `create_project` / `open_project` / `list_projects` | Cria, abre e lista projetos | Começo de todo trabalho | “Cria um projeto chamado Reels da semana” |
| `set_project` | Formato (9:16, 16:9, 1:1, 4:5), fps e cor/desfoque de fundo | Definir o formato do vídeo | “Deixa no formato de Reels” |
| `list_media_files` / `add_media` / `add_to_timeline` | Acha seus arquivos (Vídeos, Downloads, Área de Trabalho…) e coloca no vídeo | Trazer gravações e músicas | “Pega o vídeo gravacao.mp4 dos Downloads” |
| `view_frames` | Tira “fotos” do vídeo em alguns momentos para o Claude **ver** o resultado | O Claude confere tudo o que faz | “Me mostra como ficou aos 10 segundos” |
| `undo` / `redo` / `seek` | Desfazer, refazer, mover o cursor | Voltar atrás | “Desfaz isso” |

## 2. Cortes e ritmo

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `remove_silences` / `find_silences` | Corta as pausas da fala automaticamente (jump cut) | Vídeo falado ficar dinâmico | “Tira todas as pausas” |
| `remove_fillers` / `find_fillers` | Corta os **“é…”, “hum…”, “ahn…”** (hesitações). Muletas como “tipo” e “né” são só listadas, porque às vezes fazem sentido; o Claude corta as que sobram | Fala mais limpa e rápida | “Tira os ééé e hum” |
| `detect_scenes` | Acha os **cortes dentro de um vídeo** que já tem várias cenas e, se pedir, separa cada cena em um clipe | Vídeo baixado, compilado, gravação de tela | “Separa as cenas desse vídeo” |
| `cut_range` | Remove um trecho do vídeo inteiro (tudo se ajusta) | Tirar erro, repetição, trecho ruim | “Corta de 0:12 a 0:15” |
| `split_clip` / `trim_clip` / `delete_clips` / `move_clip` / `duplicate_clip` | Cortar, aparar, apagar, mover e duplicar clipes | Ajustes finos | “Divide o clipe no 5º segundo” |
| `set_speed` | Acelera ou deixa em câmera lenta | Efeito de ritmo | “Acelera essa parte 2x” |
| `find_beats` | Descobre a **batida da música** (BPM, cada batida e cada compasso) | Cortar e animar **no ritmo** | “Faz os cortes na batida da música” |

## 3. Legendas e texto

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `transcribe` | Escreve tudo o que é falado, com o tempo de cada palavra | Base para legenda, cortes e imagens | — |
| `generate_captions` | Legenda automática. Estilos prontos (`preset`): **karaoke** (a palavra falada acende em amarelo), **hormozi** (grande, 2 palavras, amarelo/verde, pulando: o visual viral), **box** (caixa roxa atrás da palavra, estilo CapCut), **one_word** (uma palavra gigante por vez), **minimal** (legenda limpa) **neon** (brilho) e **cinematic** (pequena e elegante, embaixo, estilo dos criadores de tecnologia) | Reels/TikTok | “Legenda estilo Hormozi” |
| `add_captions` | Legendas que você escreve (ex.: tradução) | Legenda em outro idioma | “Legenda em inglês” |
| `add_title` | **Títulos animados prontos**: *pop* (palavras pulando), *typewriter* (máquina de escrever), *slide_up* (palavras subindo), *highlight* (marca-texto passando), *glitch* (falha digital), *stamp* (carimbo que bate com tremida) e *editorial* (estilo revista: linha pequena em cima + manchete estreita subindo linha por linha). Cada um já vem com o som certo | Gancho, títulos de seção, números, frases de efeito | “Título ‘3 dicas’ com carimbo” |
| `set_layout` | **Troca de layout**: você desliza da tela cheia para um **quadro com borda e sombra** (do lado, embaixo ou no canto), com o fundo desfocado, e sobra espaço para um gráfico ou título. Depois volta para a tela cheia | Quando você explica ou compara algo | “Quando eu explicar os passos, me coloca num quadro e escreve ‘Passo 1’ do lado” |
| `add_text` + `set_clip_properties` | Texto na tela com fonte, cor, tamanho, caixa e posição | Títulos simples | “Título ‘Receita fácil’ no topo” |

## 4. Enquadramento e câmera

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `set_clip_properties` | Posição, tamanho, rotação, opacidade e mistura de qualquer clipe | Encaixar vídeo, PiP | “Coloca o vídeo pequeno no canto” |
| `punch_zoom` | Zoom **no rosto** em palavras de ênfase: seco, suave ou aproximando devagar | Dar ritmo a vídeo falado | “Dá zoom quando eu falar ‘grátis’” |
| `auto_reframe` | Vídeo **horizontal vira vertical** e uma “câmera” segue o rosto | Reaproveitar vídeo do YouTube em Reels | “Transforma esse vídeo deitado em Reels” |
| `animate` / `remove_animations` | Animações prontas (aparecer, sumir, deslizar, pular, girar, Ken Burns) ou personalizadas | Movimento em qualquer coisa | “Faz o logo entrar pulando” |
| `add_mask` | Recorta um clipe em forma (círculo, coração, estrela, barras de cinema…) | Visual criativo | “Coloca meu rosto num círculo” |

## 5. Efeitos “de editor profissional”

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `cutout_person` | Separa **você do fundo** com IA (no PC com placa de vídeo usa o recorte pro, cabelo fio a fio) | Colocar coisas **atrás** de você | “Coloca um texto gigante atrás de mim” |
| `explode_layers` | A cena gira em 3D e vira **camadas de vidro** (você, gráficos, fundo) com etiquetas 01/02/03, e volta | O momento “uau” do vídeo | “Faz aquele efeito de camadas 3D no meio” |
| `follow_hand` | Um objeto/logo **fica flutuando na sua mão** e segue o movimento | Mostrar produto/marca | “Coloca o logo do Instagram na minha mão” |
| `move_layer` | Muda o que fica na frente ou atrás | Organizar camadas | “Manda esse texto pra trás” |
| `create_motion_graphic` / `preview_motion_graphic` | Gráficos animados feitos em código: títulos, cards “VS”, listas, receitas, contadores, objetos 3D, telas flutuantes, CTA | Qualquer animação personalizada | “Faz um card VS entre iPhone e Samsung” |
| `apply_look` | **Filtros de cor de cinema** (LUTs, como no DaVinci): *noturno* (escuro e elegante, a parede branca fica cinza e você em destaque), *cinema* (teal & orange), *filme* (quente, cara de película), *limpo* (claro, estilo YouTube), *neon* (roxo e ciano), *pb* (preto e branco de filme). Aceita também **qualquer arquivo .cube** que você baixar. Só pinta o vídeo, não os títulos | Toda edição | “Coloca o filtro noturno” |
| `add_3d_logo` | **Logo em 3D de verdade** (Claude, ChatGPT, Gemini, Apple…): com volume, brilho metálico e girando, **flutuando na sua mão** e seguindo o movimento | Quando você cita uma marca | “Coloca o logo do Claude na minha mão” |
| `add_effect` / `update_effect` / `list_effects` | Cor (brilho, contraste, saturação, temperatura), preto e branco, sépia, vinheta, nitidez, desfoque, **fundo verde** | Acabamento de cor | “Deixa a cor mais viva” |

## 6. Imagens, ícones e animações prontas

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `search_free_media` + `add_web_image` | Busca **fotos profissionais grátis** (StockSnap, WordPress, Wikimedia) com prévia, e coloca no vídeo como card, tela cheia ou foto simples. Com `match`, uma **IA confere cada foto** (CLIP) e diz se ela mostra mesmo o que foi falado | Mostrar o que você cita | “Coloca imagens quando eu citar alguma coisa” |
| **Foto 3D** (`photo3d` em `add_web_image`/`place_image`) | A IA calcula a profundidade da foto e uma “câmera” passa por ela: o que está perto mexe mais que o fundo. **Foto parada vira quase um vídeo** (push = aproxima, pan = de lado, orbit = gira) | B-roll em tela cheia | “Coloca a foto em 3D” |
| **Foto mais nítida** (`enhance`) | Fotos pequenas mostradas grandes ganham o **dobro de resolução por IA** (Swin2SR). É automático em tela cheia | Fotos que ficariam borradas | — |
| `place_image` | Mostra uma imagem que já está no projeto | Imagens suas | “Mostra a foto do produto aos 3s” |
| `add_animated_emoji` / `search_emoji` | **Emojis animados do Google** (~600: 🔥 pegando fogo, 😂 rindo, 🤯 explodindo, ❤️ batendo…) | Reação, piada, número | “Coloca um 🔥 animado quando eu falar isso” |
| `search_icons` + `add_icon` | Ícones, emojis parados, logos de marcas e bandeiras | Destaques rápidos | “Coloca o logo do Instagram” |
| `search_animations` + `add_animation` | **Animações de designer** (LottieFiles): confete, setas, emojis animados, botão de seguir, check, transições | Acabamento profissional | “Solta um confete no final” |
| `add_shape` | Caixas, círculos e barras (fundo para texto) | Destaque de texto | — |
| `download_media` | Baixa um arquivo de um link direto (vídeo, áudio, imagem) | Você manda um link | “Baixa esse link e coloca no vídeo” |

## 7. Transições

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `add_transition_effect` | **123 transições profissionais**: zoom com desfoque (CrossZoom), glitch, queimado de filme, cubo 3D, página virando, flash branco… com whoosh | Troca de assunto/cena | “Coloca uma transição de glitch aqui” |
| `list_transition_effects` | Lista todas, com as melhores descritas | Escolher o estilo | “Quais transições tem?” |
| `add_transition` | Transições simples (dissolver, preto, deslizar, zoom) entre clipes | Cortes discretos | “Dissolve entre as cenas” |

## 8. Som e voz

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `clean_voice` | **Limpa a voz com IA** (DeepFilterNet): tira ventilador, rua, ar-condicionado, eco | Gravou com barulho | “Limpa o áudio da minha voz” |
| `polish_voice` | **Voz de podcast**: tira o grave embolado, dá presença e brilho, e um compressor deixa todas as palavras no mesmo volume | Toda gravação de voz (depois do `clean_voice`) | “Deixa minha voz com som de podcast” |
| `master_audio` | **Volume final no padrão do Instagram/TikTok/YouTube** (-14 LUFS, medido do mesmo jeito que eles medem). Sobe ou desce tudo junto, sem mudar o equilíbrio entre voz, música e efeitos | Sempre, antes de exportar | “Ajusta o volume final” |
| `generate_voiceover` | **Narração com voz de IA em português**, gerada no seu PC | Vídeo narrado sem gravar | “Narra esse texto com voz de IA” |
| `add_sound_effect` | Efeitos sonoros. Criados na hora: pop, whoosh, swoosh_down, click, impact (estrondo), riser (suspense), ding. Gravados de verdade (Kenney, domínio público): punch (soco), mouse_click, success (acerto), notification (mensagem), error (erro), glitch, ui_open/ui_close (abrir/fechar) | Cada animação ganha som | “Coloca um soco quando o título aparecer” |
| `duck_music` | A música **abaixa sozinha quando você fala** | Sempre que tiver música + voz | “A música tá alta, abaixa quando eu falo” |
| `search_free_media` (música/som) + `download_media` | Música e sons grátis com licença livre | Trilha sonora | “Coloca uma música animada” |
| `set_volume` / `set_track` | Volume e mudo | Ajustes | “Deixa a música mais baixa” |

## 9. Exportar

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `export_video` | Gera o vídeo final em **Vídeos\OpenCut**. Se usou coisas da internet, cria ao lado o **`<vídeo> - créditos.txt`** (autor e licença, e uma linha pronta para a legenda do post) | Final | “Exporta o vídeo” |
| `check_task` | Espera tarefas longas (exportar, legendar, recorte, 3D) | O Claude usa sozinho | — |

---

## Como o Claude edita “como um editor humano”

Quando você pede um vídeo profissional, ele segue este roteiro:

1. **Entende o vídeo:** vê quadros e transcreve palavra por palavra.
2. **Som:** limpa a voz se tiver ruído e dá o som de podcast; corta pausas, “é…/hum…” e frases repetidas.
3. **Formato:** 9:16; se o vídeo for horizontal, reenquadra seguindo o rosto.
4. **Gancho (primeiros 2 s):** título animado forte (carimbo ou pop) com som + zoom.
5. **Ritmo:** algo muda a cada 2–4 s (zoom no rosto, imagem conferida pela IA do que você cita, foto 3D, título, emoji animado, gráfico); transições nas trocas de assunto.
6. **Legenda animada** (Hormozi, caixa ou karaokê) no terço de baixo, sem cobrir o rosto.
7. **1 ou 2 momentos “uau”:** camadas 3D, texto atrás de você, logo na mão.
8. **Som:** efeito em cada animação; música que abaixa na fala; cortes na batida.
9. **Cor** levemente mais viva.
10. **CTA** no final (seguir/comentar) com ding.
11. **Volume final** no padrão das redes (-14 LUFS).
12. **Revisão:** confere os quadros, corrige o que sobrepôs, exporta e te diz onde ficou o vídeo e os créditos.

## Pedido pronto para colar

> Edite meu vídeo **[nome do arquivo]** como um editor profissional de Reels:
> corte as pausas e os “é/hum”, limpe a voz e deixe com som de podcast,
> zooms no rosto, legenda estilo Hormozi, título animado no gancho, imagens
> (em 3D) quando eu citar algo, emojis animados nas reações, um momento de
> camadas 3D, transições nas trocas de assunto, efeitos sonoros, música de
> fundo que abaixa quando eu falo, CTA no final e volume no padrão do
> Instagram.

## Primeira vez e internet

Algumas funções baixam um modelo de IA **só na primeira vez** (depois
funcionam sem internet): legendas, recorte, zoom no rosto, mão, limpeza de voz,
voz de IA, conferência de fotos, foto 3D e foto mais nítida. Buscas de imagens/música/animações precisam de internet sempre.

## Atualizações

O OpenCut verifica sozinho se existe versão nova ao abrir e pergunta se quer
atualizar. A extensão do Claude recebe as ferramentas novas junto com o app,
sem precisar reinstalar.
