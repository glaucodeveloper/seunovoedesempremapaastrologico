# Seu Novo e de Sempre — roda solar histórica via API

## O que mudou

- O pitch inicial explica a tese temporal/sazonal do método.
- A roda anual continua referenciada ao hemisfério sul.
- A roda diária deixa de usar 04:00/12:00 fixos como relógio universal.
- O local de nascimento é geocodificado via Open-Meteo.
- Os eventos solares históricos são requisitados da API v2 do Sunrise-Sunset.org.
- Leão começa no meio-dia solar local da data de nascimento.
- Áries começa oito horas antes.
- Os 12 setores continuam tendo 2 horas cada.
- O horário de verão histórico aparece no deslocamento do meio-dia solar no relógio civil.
- Se uma API falhar, o site informa a falha e volta ao eixo-base 04:00/12:00, sem fingir que o cálculo solar foi concluído.

## Produção comercial

O Sunrise-Sunset.org exige atribuição visível, já incluída na interface.
Para geocodificação comercial, configure o plano/provedor adequado em vez de depender indefinidamente de uma cota pública de demonstração.
