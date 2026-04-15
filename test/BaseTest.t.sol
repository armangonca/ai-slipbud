//SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "test/MockERC20.sol";
import {SlipBudRouter} from "contracts/SlipBudRouter.sol";
import {SlipBudTreasury} from "contracts/SlipBudTreasury.sol";
import {ITreasury} from "contracts/interfaces/ITreasury.sol";
import {IRouter} from "contracts/interfaces/IRouter.sol";
import {HelperConfig} from "script/HelperConfig.s.sol";
import {SlipBudDeployScript} from "script/SlipBudDeployScript.s.sol";

contract BaseTest is Test {
    SlipBudDeployScript public deployer;
    function setUp() public virtual {
        deployer = new SlipBudDeployScript();
    }
}
