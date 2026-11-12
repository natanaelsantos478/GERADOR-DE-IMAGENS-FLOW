/** UI strings (pt-BR). Keys: ui.<area>.<name>. */
export const uiPt: Record<string, string> = {
  // generic
  'ui.close': 'Fechar', 'ui.back': 'Voltar', 'ui.cancel': 'Cancelar', 'ui.days': 'dias', 'ui.perMonth': '/mês', 'ui.layers': 'Camadas',
  // menu
  'ui.menu.subtitle': 'Comando Global', 'ui.menu.new': 'Novo jogo', 'ui.menu.continue': 'Continuar', 'ui.menu.load': 'Carregar jogo', 'ui.menu.settings': 'Configurações',
  'ui.menu.credits': 'Créditos', 'ui.menu.pause': 'Menu', 'ui.menu.resume': 'Voltar ao jogo', 'ui.menu.saveLoad': 'Salvar / carregar', 'ui.menu.quit': 'Sair para o menu principal',
  // new game
  'ui.newgame.title': 'Escolha seu país', 'ui.newgame.hint': 'Clique no globo ou escolha na lista.', 'ui.newgame.search': 'Pesquisar país…',
  'ui.newgame.start': 'Iniciar', 'ui.newgame.automation': 'Automações (opcionais)',
  'ui.diff.sandbox': 'Sandbox', 'ui.diff.normal': 'Normal', 'ui.diff.hard': 'Difícil',
  'ui.diff.sandbox.desc': 'Dinheiro livre para construir e testar tudo, sem risco.', 'ui.diff.normal.desc': 'Rivais pouco agressivos: ideal para aprender o jogo.',
  'ui.diff.hard.desc': 'IA mais ativa e economia menos tolerante.',
  'ui.auto.eco.budget': 'Orçamento automático', 'ui.auto.eco.build': 'Construção automática', 'ui.auto.eco.trade': 'Comércio automático', 'ui.auto.mil.production': 'Produção militar automática',
  'ui.autoHelp.eco.budget': 'O governo ajusta impostos e gastos para manter o equilíbrio.', 'ui.autoHelp.eco.build': 'O governo constrói usinas e infraestrutura conforme a necessidade.',
  'ui.autoHelp.eco.trade': 'Compra e venda recursos em falta ou em excesso.',
  // country facts
  'ui.country.capital': 'Capital', 'ui.country.pop': 'População', 'ui.country.gdp': 'PIB', 'ui.country.growth': 'Crescimento', 'ui.country.milExp': 'Gasto militar',
  'ui.country.armed': 'Forças armadas', 'ui.country.plants': 'Usinas', 'ui.country.tanks': 'Carros de combate', 'ui.country.fighters': 'Caças', 'ui.country.navy': 'Navios e submarinos',
  'ui.country.nukes': 'Ogivas nucleares', 'ui.country.alliances': 'Alianças', 'ui.country.noAlliances': 'Nenhuma aliança',
  // save / load
  'ui.save.title': 'Salvar jogo', 'ui.load.title': 'Carregar jogo', 'ui.save.slotName': 'Nome do slot', 'ui.save.save': 'Salvar', 'ui.save.export': 'Exportar arquivo', 'ui.save.import': 'Importar arquivo…',
  'ui.save.slot': 'Slot', 'ui.save.country': 'País', 'ui.save.gameDate': 'Data no jogo', 'ui.save.size': 'Tamanho', 'ui.save.delete': 'Apagar', 'ui.save.empty': 'Nenhum jogo salvo.',
  'ui.load.load': 'Carregar', 'ui.save.saved': 'Jogo salvo em “{name}”.', 'ui.save.loaded': 'Jogo “{name}” carregado.', 'ui.save.error': 'Falha no save: {msg}',
  // settings
  'ui.settings.title': 'Configurações', 'ui.settings.gfx': 'Gráficos', 'ui.settings.audio': 'Áudio', 'ui.settings.keys': 'Chaves opcionais', 'ui.settings.game': 'Jogo',
  'ui.settings.resScale': 'Escala de resolução', 'ui.settings.dayNight': 'Ciclo de dia e noite (iluminação solar)', 'ui.settings.layers': 'Camadas do mapa',
  'ui.settings.volMaster': 'Volume geral', 'ui.settings.volMusic': 'Música', 'ui.settings.volSfx': 'Efeitos',
  'ui.settings.keysHelp': 'Opcional. Sem chaves o jogo usa imagens e relevo gratuitos. Um token Cesium ion ativa terreno e prédios OSM; uma chave Google ativa os Photorealistic 3D Tiles. As chaves ficam só neste navegador.',
  'ui.settings.ionToken': 'Token Cesium ion', 'ui.settings.googleKey': 'Chave Google Maps (Photorealistic 3D Tiles)', 'ui.settings.apply': 'Aplicar',
  'ui.settings.autosave': 'Autosave mensal (slot “autosave”)', 'ui.settings.shortcuts': 'Atalhos: Espaço = pausar · 1 a 5 = velocidade · Esc = fechar / menu.',
  'ui.layer.countryBorders': 'Fronteiras de países', 'ui.layer.provinceBorders': 'Fronteiras de províncias', 'ui.layer.roads': 'Estradas', 'ui.layer.railways': 'Ferrovias',
  'ui.layer.countryLabels': 'Nomes de países', 'ui.layer.cities': 'Cidades', 'ui.layer.cityLabels': 'Nomes de cidades', 'ui.layer.plants': 'Usinas', 'ui.layer.airports': 'Aeroportos', 'ui.layer.ports': 'Portos', 'ui.layer.fill': 'Preenchimento',
  // credits
  'ui.credits.title': 'Créditos e atribuições', 'ui.credits.data': 'Dados', 'ui.credits.imagery': 'Imagens de satélite e relevo', 'ui.credits.models': 'Modelos 3D', 'ui.credits.audio': 'Áudio',
  'ui.credits.icons': 'Ícones', 'ui.credits.software': 'Software', 'ui.credits.original': 'Obra original',
  // top bar
  'ui.top.gotoCapital': 'Ir para a capital', 'ui.top.pause': 'Pausar / continuar', 'ui.top.speed': 'Velocidade {n}', 'ui.top.money': 'Finanças', 'ui.top.treasury': 'Tesouro', 'ui.top.balance': 'Saldo',
  'ui.top.debt': 'Dívida', 'ui.top.energy': 'Energia', 'ui.top.supply': 'Oferta', 'ui.top.demand': 'Demanda', 'ui.top.coverage': 'Cobertura', 'ui.top.stability': 'Estabilidade',
  'ui.top.approval': 'Aprovação do governo', 'ui.top.manpowerTip': 'Mão de obra disponível para recrutamento',
  // sidebar panels
  'ui.panel.economy': 'Economia', 'ui.panel.budget': 'Orçamento', 'ui.panel.energy': 'Energia', 'ui.panel.construction': 'Construção', 'ui.panel.population': 'População', 'ui.panel.trade': 'Comércio',
  'ui.panel.diplomacy': 'Diplomacia', 'ui.panel.research': 'Pesquisa', 'ui.panel.forces': 'Forças Armadas', 'ui.panel.production': 'Produção', 'ui.panel.intelligence': 'Inteligência',
  // feed
  'ui.feed.title': 'Notícias', 'ui.feed.mine': 'Meu país', 'ui.feed.all': 'Mundo', 'ui.feed.empty': 'Sem notícias por enquanto.',
  'ui.news.economy': 'Economia', 'ui.news.diplomacy': 'Diplomacia', 'ui.news.research': 'Pesquisa', 'ui.news.military': 'Militar', 'ui.news.tactical': 'Batalhas', 'ui.news.politics': 'Política', 'ui.news.world': 'Mundo', 'ui.news.disaster': 'Desastres', 'ui.news.game': 'Jogo',
  // inspectors
  'ui.insp.sea': 'Mar aberto', 'ui.insp.area': 'Área', 'ui.insp.elev': 'Altitude média', 'ui.insp.urbanPop': 'População urbana', 'ui.insp.plants': 'Usinas', 'ui.insp.occupiedBy': 'Ocupada por',
  'ui.insp.cities': 'Cidades', 'ui.insp.buildings': 'Construções', 'ui.insp.done': 'concluída', 'ui.insp.inhabitants': 'habitantes', 'ui.insp.satisfaction': 'Satisfação', 'ui.insp.blackout': 'Apagão',
  'ui.insp.causes': 'Causas', 'ui.insp.damage': 'Dano', 'ui.insp.condition': 'Estado', 'ui.insp.health': 'Integridade', 'ui.insp.repair': 'Reparar', 'ui.insp.repairing': 'Em reparo',
  'ui.insp.capacity': 'Capacidade', 'ui.insp.fuel': 'Combustível', 'ui.insp.size': 'Porte', 'ui.insp.iata': 'Código IATA', 'ui.insp.type': 'Tipo', 'ui.insp.military': 'Militar', 'ui.insp.civil': 'Civil',
  'ui.insp.progress': 'Progresso', 'ui.insp.goto': 'Ir para lá', 'ui.size.0': 'Pequeno', 'ui.size.1': 'Médio', 'ui.size.2': 'Grande',
  'ui.dip.atWar': 'Em guerra', 'ui.dip.allied': 'Aliado', 'ui.dip.tradeDeal': 'Acordo comercial', 'ui.dip.puppetOf': 'Fantoche de {c}', 'ui.dip.dead': 'Eliminado', 'ui.dip.relation': 'Relação com você',
  'ui.dip.power': 'Poder militar', 'ui.dip.open': 'Diplomacia', 'ui.dip.soon': 'O painel de diplomacia não está disponível nesta versão.',
  'ui.kind.powerPlant': 'Usina', 'ui.kind.civilFactory': 'Fábrica civil', 'ui.kind.militaryFactory': 'Fábrica militar', 'ui.kind.refinery': 'Refinaria', 'ui.kind.mine': 'Mina', 'ui.kind.farm': 'Fazenda',
  'ui.kind.hospital': 'Hospital', 'ui.kind.university': 'Universidade', 'ui.kind.road': 'Estrada', 'ui.kind.railway': 'Ferrovia', 'ui.kind.port': 'Porto', 'ui.kind.airport': 'Aeroporto',
  'ui.kind.militaryBase': 'Base militar', 'ui.kind.airDefense': 'Defesa antiaérea', 'ui.kind.radar': 'Radar', 'ui.kind.silo': 'Silo de mísseis', 'ui.kind.bunker': 'Bunker',
  // economy
  'ui.eco.gdp': 'PIB', 'ui.eco.growth': 'Crescimento anual', 'ui.eco.inflation': 'Inflação', 'ui.eco.interest': 'Juros', 'ui.eco.sectors': 'Setores da economia', 'ui.eco.balance': 'Saldo mensal',
  'ui.eco.mood': 'Aprovação e estabilidade', 'ui.eco.automation': 'Automação',
  // budget
  'ui.bud.taxes': 'Impostos', 'ui.bud.burden': 'carga tributária', 'ui.bud.spending': 'Gastos por área (100% = nível base)', 'ui.bud.ledger': 'Livro-razão mensal', 'ui.bud.revenue': 'Receitas', 'ui.bud.expense': 'Despesas',
  'ui.bud.debt': 'Dívida pública', 'ui.bud.borrow': 'Tomar empréstimo', 'ui.bud.repay': 'Amortizar',
  'ui.bud.taxHelp.income': 'Mais imposto de renda enche o caixa, mas reduz a aprovação e o consumo.', 'ui.bud.taxHelp.corporate': 'Mais imposto sobre empresas reduz investimento e crescimento.',
  'ui.bud.taxHelp.consumption': 'Imposto sobre consumo rende rápido, mas pesa na satisfação e na inflação.',
  'ui.bud.pillarHelp.health': 'Saúde: melhora a satisfação e a expectativa de vida.', 'ui.bud.pillarHelp.education': 'Educação: eleva a produtividade no longo prazo.',
  'ui.bud.pillarHelp.security': 'Segurança: reduz agitação e revoltas.', 'ui.bud.pillarHelp.infrastructure': 'Infraestrutura: eficiência da economia e reparos.',
  'ui.bud.pillarHelp.social': 'Assistência social: sobe a aprovação, custa caro.', 'ui.bud.pillarHelp.defense': 'Defesa: investimento na indústria militar.', 'ui.bud.pillarHelp.research': 'Pesquisa: acelera o desenvolvimento de tecnologias.',
  // energy
  'ui.en.imports': 'Importação', 'ui.en.exports': 'Exportação', 'ui.en.blackouts': 'Apagões', 'ui.en.citiesDark': '{n} de {total} cidades', 'ui.en.none': 'nenhum', 'ui.en.byFuel': 'Geração por combustível',
  'ui.en.contracts': 'Contratos de energia', 'ui.en.noContracts': 'Nenhum contrato.', 'ui.en.direction': 'Contrato', 'ui.en.exportTo': 'Fornece a', 'ui.en.importFrom': 'Compra de', 'ui.en.chooseCountry': 'Escolha um país…',
  'ui.en.sell': 'Fornecer energia', 'ui.en.build': 'Construir usinas',
  // construction
  'ui.con.new': 'Nova obra', 'ui.con.queue': 'Fila', 'ui.con.repair': 'Reparos', 'ui.con.location': 'Local da obra', 'ui.con.useSelection': 'Usar seleção', 'ui.con.pick': 'Escolher no globo',
  'ui.con.pickBanner': 'Clique no globo para escolher o local da obra.', 'ui.con.name': 'Obra', 'ui.con.cost': 'Custo', 'ui.con.build': 'Construir', 'ui.con.noOptions': 'Nada pode ser construído neste local.',
  'ui.con.blockedHint': 'Bloqueio', 'ui.con.emptyQueue': 'Nenhuma obra em andamento.', 'ui.con.eta': 'Prazo', 'ui.con.noDamage': 'Nenhuma infraestrutura danificada.',
  // population
  'ui.pop.election': 'Próxima eleição', 'ui.pop.weariness': 'Cansaço de guerra', 'ui.pop.nationalCauses': 'O que move a satisfação no país', 'ui.pop.cities': 'Cidades', 'ui.pop.city': 'Cidade', 'ui.pop.population': 'População',
  'ui.pop.hint': 'Mostrando as 150 maiores cidades. Clique para ver detalhes.',
  // trade
  'ui.trade.blockaded': 'Seu comércio exterior está bloqueado.', 'ui.trade.qty': 'Quantidade', 'ui.trade.fees': 'Compra com 8% de ágio; venda com 8% de deságio.', 'ui.trade.resource': 'Recurso',
  'ui.trade.stock': 'Estoque', 'ui.trade.netDay': 'Saldo/dia', 'ui.trade.unmet': 'Falta', 'ui.trade.price': 'Preço', 'ui.trade.buy': 'Comprar', 'ui.trade.sell': 'Vender',
  'ui.trade.embargoes': 'Embargos impostos por você', 'ui.trade.noEmbargo': 'Nenhum embargo.', 'ui.trade.embargo': 'Embargar',
  // core errors
  'err.command.badArgs': 'Comando inválido.', 'err.command.notPlayer': 'Só o país do jogador pode usar este comando.', 'err.command.systemMissing': 'Sistema indisponível.',
  'err.command.unknown': 'Comando desconhecido: {type}', 'err.command.unknownCountry': 'País desconhecido: {country}', 'err.command.unknownPrefix': 'Comando desconhecido.', 'err.game.badSpeed': 'Velocidade inválida.',
};
