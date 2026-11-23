# Islanders 研究:这类游戏是怎么做的

2026-11-22。给 Mars Homecoming 的设计参考。配套的设计稿是 `MR-City-Building-Design.xlsx`(Google Drive 上的"MR City Building 设计稿")。

## 数据来源和可信度

- **Wiki**:islanders.fandom.com 全部 74 个正文页面(通过 MediaWiki API 读取)。每个建筑的加减分、卡包门槛、换岛门槛来自这里。Wiki 只更新到 2019 年 5 月,内部有少量互相矛盾的数字。
- **攻略**:一篇 2019 年 8 月的 Steam 攻略(steamah.com/islanders-complete-guide)。每个卡包的建筑数量来自这里,可信度比 Wiki 低。
- **没查到**:每个建筑的探测半径数值、卡包的解锁树(哪个包之后出哪个包)、换岛时手里的建筑是否带走。
- 标"推断"的是从数据里读出来的结论,不是 Wiki 原文。

## 1. 压力:建筑是唯一的资源,分数是拿到更多建筑的门票

- 游戏里没有金钱。玩家手里只有建筑,放下去得分。
- 分数到门槛,才能二选一拿下一个卡包(约 6 个建筑)。
- 手里的建筑放完还没到门槛,只能去下一座岛。下一座岛也没解锁,游戏结束。
- 压力来自两头:门槛越来越高,岛上的空地越来越少。建筑放下后不能拆(后来只加了撤销最后一步)。
- 换岛是泄压阀:第一座岛 200 分解锁,换岛送 100 分,卡包门槛从 20 重新开始。所以难度是锯齿形,每座岛开头都轻松。

## 2. 数值增长:门槛线性加速,单个建筑的收益涨十倍

**卡包门槛(每座岛内)**

| 第几个 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| 所需分数 | 20 | 70 | 125 | 185 | 250 | 320 | 395 | 475 |
| 和上一个差 | 20 | 50 | 55 | 60 | 65 | 70 | 75 | 80 |

间隔每次多 5 分,没有上限。

**换岛门槛**:200、700、1600、2900、4600,间隔每次多 400。换岛时分数加 100 并向上取整到 10(203 分换岛后是 310)。

**单个建筑的收益**

- 早期建筑一次放置拿 1 到 7 分(Lumberjack 靠近树 +1 到 +3,Field 底分 +3)。
- 后期建筑自带很大的负底分,要靠事先布好的局赚回来:
  - Temple 底分 −75;旁边有 Statue +40、Mason +25、Plateau +25、Shaman +15。
  - Gold Mine 底分 −20;靠金矿脉 +35、Warehouse +10、Jewelry +10。
  - Jewelry 底分 −35;靠 Gold Mine +30。
  - Market 底分 −20;靠 Warehouse +20。
  - Tavern 底分 −15;靠 Brewery +18。
- 成就把单个建筑一次拿 25、50、75 分当作里程碑,说明后期一次放置是早期的十倍。

## 3. 卡包逻辑:每包是一个小生态,包与包之间既有枢纽也有冲突

| 手法 | 例子 |
|---|---|
| 一个生产者配一个填充物 | Lumberjack + Sawmill,Field + Mill,Hop Field + Brewery,Seaweed Field + Seaweed Farm |
| 同类加减分分三档 | 填充物自己加分(House +1、Field +2、Hop Field +2);生产者中等扣分(Lumberjack −6、Brewery −11、Sawmill −12、Mill −20);地标几乎只能放一个(Tower −30、Market −35、City Center −40、Balloon −45、Monument −100) |
| 枢纽建筑串起多个包 | Warehouse 给几乎所有工业加分;City Center 给所有住宅加分;Statue 给所有建筑加分 |
| 跨类冲突逼你分区 | Temple 旁每个工业建筑(Brickyard、Mill、Sawmill、Warehouse、Market、Tavern、Gold Mine、Circus)−20;Park 旁 Sawmill −5、Mill −4、Lumberjack −4;Resort Oasis 旁工业和住宅 −5 到 −10 |
| 同一区里再细分 | Circus 让 House +4 但 Mansion −5;Jewelry 让 Mansion +2 但 House −2 |
| 地形锁 | Sandpit 只能放沙地,Mason 要岩石或崖边,Fisher 和 Seaweed Field 要水,雪地图没有田 |
| 评分不对称 | Brewery 靠近 Hop Field +5,Hop Field 靠近 Brewery +4;所以放的先后顺序有讲究 |
| 新包补发旧建筑(攻略,推断) | 每包约 6 个建筑,1 到 3 个是新主题,其余是已解锁的建筑 |

没有"半径内最多几个"这类硬规则,拥挤完全靠同类扣分控制。

## 4. 策略:分数只在放下时结算一次,所以顺序和留白是核心

- 提前划好工业区、住宅区、豪宅区。
- 给 Temple、Market、Monument 这类大件预留位置,并先把加分邻居摆好。
- 尽量贴紧摆放节省空间。
- 有些扣分值得吃,只要能过门槛。
- 城市包尽量晚拿,拿了之后农业和工业包出现得更少(攻略)。
- 第一座岛尽量榨干再走;地形差的岛可以直接重开。

## 5. 对照 Mars Homecoming(2026-11-22 的设计稿)

1. **压力来源偏弱。** 手牌用完就无条件发下一手,失败只来自预算小于 0,而平地上柱费接近 0。
2. **门槛曲线到头就平了。** 20、50、90、140、200,之后固定每 80 分,奖励固定 +30 预算。
3. **缺少地标建筑。** 单次得分在 +2 到 +10 之间,最大扣分是 SpacePort 之间的 −15,没有负底分、高回报、需要布局的大件。
4. **几乎没有跨类冲突。** 扣分都是同类之间的,没有工业对居住这类分区压力。
5. **已经做对的部分。** 同类扣分分档(Farm 和 LivingPod 自己加分,Factory −7,Warehouse −10)、Warehouse 当万能邻居、资源点和地形锁、不对称评分。
6. **第二张沙盘**对应 Islanders 的换岛泄压阀。

## 6. 方向决定(Peng,2026-11-22)

- 只做一张沙盘,不做多张沙盘。
- 门槛曲线暂时不动。
- 平地柱费约等于 0 是游戏的一部分,保留。
- 压力不走"纯生存",走"花钱赚钱":卡包可以随时花预算买。
- SpacePort 改成地标建筑,每局一定会出现。
- MVP 最先做跨类冲突。

## 7. 提案(还没定,数值没有实测)

### 7a. 跨类冲突

把建筑分成三类:工业(Excavator、Factory、GasExtractor、CliffDrill)、居住(LivingPod、Farm、Bar)、物流(Warehouse、SpacePort)。在评分表里加下面这些格子,两个方向都加,这样先放谁都躲不掉。

| 正在放的建筑 | 新增的邻居加减分 |
|---|---|
| LivingPod | Factory −4,GasExtractor −3,Excavator −2,CliffDrill −2 |
| Farm | Factory −3,GasExtractor −3 |
| Factory | LivingPod −2,Farm −1 |
| GasExtractor | LivingPod −1,Farm −1 |
| Excavator | LivingPod −2 |
| Bar | Factory +2(工人下班喝酒,Bar 是两个区之间的缓冲) |

Warehouse 保持万能邻居,自然成为两个区之间的另一种缓冲。

**数值是怎么协调的(2026-11-22)**:按探测半径定每个邻居扣多少。Factory 的半径 20 cm,一次能盖住沙盘的 37%;GasExtractor 17.5 cm,盖住 28%;它们放下时会同时看到很多居住建筑,所以每个只扣 1 到 2 分,一片 4 个 LivingPod 的住宅区正好抵掉一次好的工厂放置(+8 到 +11)。LivingPod 和 Farm 的半径只有 7.5 cm(沙盘的 5%),只有贴着工业建筑才会触发,所以每个扣 3 到 4 分,大约等于它们两个好邻居的收入。这组数值已写进设计稿评分表的黄色格,还没在游戏里实测。

一个后果:在 7.5 到 20 cm 这一圈里,先放工厂、后放住宅不扣分,反过来才扣。这和 Islanders 一样,顺序本身是策略。

### 7b. SpacePort 当地标

| | 现在 | 提案 |
|---|---|---|
| 底分 | 0 | −20 |
| Factory / Warehouse | +8 / +8 | +10 / +10 |
| Excavator、GasExtractor、CliffDrill | 无 | 各 +3 |
| Bar | 无 | +3 |
| LivingPod / Farm | 无 | −4 / −3 |
| SpacePort 之间 | −15 | −40 |

发牌:Trader_01 和 Trader_02 从随机牌堆里拿出来,改成每隔固定手数(比如每 4 手)一定作为二选一的选项之一出现,预算牌上提前显示"还有 N 手到 SpacePort",让玩家提前留地方、先摆工厂和仓库。

### 7c. 花钱买手牌

- 第一手免费。之后手牌不再免费发,预算牌上有一个"买手牌 −N"按钮,随时可以买,买时还是二选一。
- 价格随购买次数上涨(比如 10 起,每次 +2),这条价格曲线代替门槛曲线提供后期压力。
- 手里没有建筑、预算又买不起下一手时游戏结束。
- 里程碑解锁卡包仍然免费,是奖励。
- 要先用脚本跑一下平均每手能赚多少分,再定起价和涨幅。

## 附录:Islanders 建筑数据(Wiki)

"靠近 X +n"是指这个建筑放下时,探测范围内每个 X 给它的分。

| 建筑 | 底分 | 同类 | 放下时靠近这些建筑的加减分 |
|---|---|---|---|
| Lumberjack | 0 | −6 | Sawmill +5,Statue +4,Tree +1 到 +3 |
| Sawmill | 0 | −12 | Lumberjack +7,Warehouse +6,Statue +4 |
| Field | +3 | +2 | Mill +5,Statue +5,Plateau +3,Resort Oasis +3 |
| Mill | +8 | −20 | Statue +5,Warehouse +5,Field +4,City Center +3,Mason +2 |
| Hop Field | +5 | +2 | Statue +4,Brewery +4,Resort Oasis +3 |
| Brewery | +3 | −11 | Hop Field +5,Statue +4,Warehouse +2,Seaweed Farm +2 |
| City Center | +15 | −40 | Fisher +7,Statue +5,Mason +4,Mill +2,Seaweed Farm +2,Shaman −5,Resort Oasis −15 |
| House | +1 | +1 | City Center +6,Shaman +5,Statue +4,Plateau +3,Wall Plateau +3,Circus +3,Fountain/Market/Temple/Tavern/Tower/Mason +2,Park +1,Wall −2,Jewelry −2 |
| Mansion | +1 | +1 | City Center +8,Shaman +6,Plateau +6,Wall Plateau +6,Statue +5,Fountain +3,Park/Market/Tower/Temple/Jewelry +2,Circus −3,Wall −3 |
| Brickyard | +6 | −8 | Mason +5,Warehouse +4,Sandpit +4,Statue +3 |
| Sandpit | +9 | −3 | Statue +3,Brickyard +3 |
| Mason | +9 | −4 | Brickyard +4,Statue +3,Warehouse +3,Tower/Market/City Center/Plateau/Temple/Wall +2,Shaman −5 |
| Seaweed Farm | +6 或 +10 | −24 | Seaweed Field +4,Statue +3 |
| Seaweed Field | −1 | +1 | Seaweed Farm +9,Plateau +4,Statue +3 |
| Statue | +15 | −25 | 无 |
| Gold Mine | −20 | 无 | Gold Vein +35,Warehouse +10,Jewelry +10,Statue +5,Resort Oasis −10 |
| Jewelry | −35 | −30 | Gold Mine +30,Statue +6,Mansion +5,Wall −3,House −4 |
| Fisher | +4 | −11 | City Center +7,Warehouse +2,Statue +2,Hut +1,Seaweed Field +1,Seaweed Farm −4 |
| Shaman | 0 | −13 | Statue +5,Temple +5,Flower +3,Seaweed Field +2,Mason −6,City Center −10 |
| Hut | +4 | 无 | City Center +6,Statue +2,Shaman +2,Fisher +1,Seaweed Farm +1;Sawmill、Lumberjack、Warehouse、Brickyard、Mill、Mason 各 −1 |
| Fountain | 0 | −15 | City Center +7,Statue +3,Park +3,Mansion +3,House +2 |
| Park | +2 | 无 | Resort Oasis +5,Fountain +4,Temple +4,Hop Field +3,Tower +3,Field/Plateau/Statue/City Center +2,House/Mansion/Tree +1,Wall −2,Warehouse −2,Brickyard −3,Lumberjack −4,Mill −4,Sawmill −5 |
| Tower | 0 | −30 | Temple +8,Mason +5,Balloon +5,Statue +4,Wall/House/Park/Mansion +1 |
| Wall | +2 | −12 | Temple +10,Jewelry +7,Market +7,City Center +6,Warehouse +6,Plateau +4,Statue +4,House/Park/Mason/Mansion +3,Hut +1 |
| Warehouse | 0 | −15 | Gold Mine +7,Market +7,Mill +7,Brickyard +6,Fisher +6,Brewery +5,Mason +5,Sawmill +4,Seaweed Farm +4,Statue +4,Resort Oasis −5 |
| Market | −20 | −35 | Warehouse +20,City Center +5,Mason +4,Statue +4,Fisher +3,House +2,Mansion +2 |
| Tavern | −15 | −15 | Brewery +18,City Center +8,Statue +4,House +2 |
| Circus | 0 | −10 | Statue +10,House +4,Mansion −5,Temple −25 |
| Temple | −75 | 无 | Statue +40,Mason +25,Plateau +25,Shaman +15,City Center/Mansion/Tower/Wall +10,House +8,Park +5;Brickyard、Circus、Gold Mine、Market、Mill、Sawmill、Tavern、Warehouse 各 −20 |
| Monument | −15 | −100 | Temple +20,City Center +15,Park +8,Statue +4,Field −5,Hop Field −7 |
| Balloon | −15 | −45 | Resort Oasis/Market/Tower/Circus +15,Statue +10,Temple −25 |
| Resort Oasis | 0 | 无 | Hop Field +7,Plateau +6,Water Plateau/Park/Fountain +5,Statue +4,Tree +3,Field +3,Fisher/Brewery/Flower +2,Mill −3,Lumberjack/Brickyard/House/Seaweed Field −5,Mansion −7,Mason/Warehouse/City Center/Sawmill/Gold Mine −10 |
| Plateau | 0 | +4 | City Center +10,Mason +8,Statue +2,Seaweed Field +1 |
| Wall Plateau | +10 | +1 | City Center +4,Statue +2 |
| Water Plateau | +13 | +1 | Sawmill +3,Statue +2,Tree +1 |

**卡包内容(攻略,只列新主题建筑)**:Lumber = 2 Lumberjack + 1 Sawmill;Seaweed = 2 Seaweed Field + 1 Seaweed Farm;Farming = 2 Field + 1 Mill;Brewing = 1 Hop Field + 1 Brewery;City = 3 Mansion + 2 House + 1 City Center;Shaman = 1;Water Plateau = 1;Fisher = 2;Fountain = 1;Hut = 3;Park = 2。后期的包(Brickyard、Mason、Tower、Warehouse、Circus、Gold Mine、Market、Resort Oasis、Tavern、Temple、Wall)在大部分基础包拿过之后才出现。
