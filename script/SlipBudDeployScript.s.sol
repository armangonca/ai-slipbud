// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {SlipBudFactory} from "../contracts/SlipBudFactory.sol";
import {SlipBudTreasury} from "../contracts/SlipBudTreasury.sol";
import {SlipBudRouter} from "../contracts/SlipBudRouter.sol";
import {HelperConfig} from "./HelperConfig.s.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SlipBudDeployScript is Script {
    function run() external returns (SlipBudTreasury treasury, SlipBudRouter router) {
        HelperConfig helperConfig = new HelperConfig();
        (address weth, , , , address aaveV3Pool) = helperConfig.activeConfig();

        address bot = vm.envAddress("BOT_ADDRESS");

        console.log("Deploying on chain:", block.chainid);
        console.log("WETH:", weth);
        console.log("Aave Pool:", aaveV3Pool);
        console.log("Bot:", bot);

        vm.startBroadcast();

        // Factory: tek TX'te Treasury + Router deploy + ROUTER_ROLE grant
        SlipBudFactory factory = new SlipBudFactory();

        (treasury, router) = factory.deploy(
            SlipBudFactory.DeployParams({
                asset: IERC20(weth),
                vaultName: "SlipBud Vault",
                vaultSymbol: "sbVAULT",
                bot: bot,
                aavePool: aaveV3Pool,
                routers: helperConfig.getAllowedRouters(),
                tokens: helperConfig.getAllowedTokens()
            })
        );

        console.log("Treasury:", address(treasury));
        console.log("Router:", address(router));

        vm.stopBroadcast();
    }
}
