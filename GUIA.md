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
| `cut_range` | Remove um trecho do vídeo inteiro (tudo se ajusta) | Tirar erro, repetição, trecho ruim | “Corta de 0:12 a 0:15” |
| `split_clip` / `trim_clip` / `delete_clips` / `move_clip` / `duplicate_clip` | Cortar, aparar, apagar, mover e duplicar clipes | Ajustes finos | “Divide o clipe no 5º segundo” |
| `set_speed` | Acelera ou deixa em câmera lenta | Efeito de ritmo | “Acelera essa parte 2x” |
| `find_beats` | Descobre a **batida da música** (BPM, cada batida e cada compasso) | Cortar e animar **no ritmo** | “Faz os cortes na batida da música” |

## 3. Legendas e texto

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `transcribe` | Escreve tudo o que é falado, com o tempo de cada palavra | Base para legenda, cortes e imagens | — |
| `generate_captions` | Legenda automática. Estilo **karaokê**: a palavra falada acende | Reels/TikTok | “Coloca legenda karaokê amarela” |
| `add_captions` | Legendas que você escreve (ex.: tradução) | Legenda em outro idioma | “Legenda em inglês” |
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
| `add_effect` / `update_effect` / `list_effects` | Cor (brilho, contraste, saturação, temperatura), preto e branco, sépia, vinheta, nitidez, desfoque, **fundo verde** | Acabamento de cor | “Deixa a cor mais viva” |

## 6. Imagens, ícones e animações prontas

| Ferramenta | O que faz | Quando usar | Exemplo |
|---|---|---|---|
| `search_free_media` + `add_web_image` | Busca **fotos profissionais grátis** (StockSnap, WordPress, Wikimedia) com prévia, e coloca no vídeo como card, tela cheia ou foto simples | Mostrar o que você cita | “Coloca imagens quando eu citar alguma coisa” |
| `place_image` | Mostra uma imagem que já está no projeto | Imagens suas | “Mostra a foto do produto aos 3s” |
| `search_icons` + `add_icon` | Ícones, emojis, logos de marcas e bandeiras | Destaques rápidos | “Coloca um emoji de fogo” |
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
| `generate_voiceover` | **Narração com voz de IA em português**, gerada no seu PC | Vídeo narrado sem gravar | “Narra esse texto com voz de IA” |
| `add_sound_effect` | Efeitos sonoros: pop, whoosh, impacto, clique, riser (suspense), ding | Cada animação ganha som | “Coloca um whoosh nas transições” |
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
2. **Som:** limpa a voz se tiver ruído; corta pausas e frases repetidas.
3. **Formato:** 9:16; se o vídeo for horizontal, reenquadra seguindo o rosto.
4. **Gancho (primeiros 2 s):** título forte com som de impacto + zoom.
5. **Ritmo:** algo muda a cada 2–4 s (zoom no rosto, imagem do que você cita, gráfico, ícone); transições nas trocas de assunto.
6. **Legenda karaokê** no terço de baixo, sem cobrir o rosto.
7. **1 ou 2 momentos “uau”:** camadas 3D, texto atrás de você, logo na mão.
8. **Som:** efeito em cada animação; música que abaixa na fala; cortes na batida.
9. **Cor** levemente mais viva.
10. **CTA** no final (seguir/comentar) com ding.
11. **Revisão:** confere os quadros, corrige o que sobrepôs, exporta e te diz onde ficou o vídeo e os créditos.

## Pedido pronto para colar

> Edite meu vídeo **[nome do arquivo]** como um editor profissional de Reels:
> corte as pausas, limpe a voz, zooms no rosto, legenda karaokê, imagens
> quando eu citar algo, um momento de camadas 3D, transições nas trocas de
> assunto, efeitos sonoros, música de fundo que abaixa quando eu falo, e CTA
> no final.

## Primeira vez e internet

Algumas funções baixam um modelo de IA **só na primeira vez** (depois
funcionam sem internet): legendas, recorte, zoom no rosto, mão, limpeza de voz
e voz de IA. Buscas de imagens/música/animações precisam de internet sempre.

## Atualizações

O OpenCut verifica sozinho se existe versão nova ao abrir e pergunta se quer
atualizar. A extensão do Claude recebe as ferramentas novas junto com o app,
sem precisar reinstalar.
